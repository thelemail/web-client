<script lang="ts">
	import { platform } from '$platform';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Smartphone from '@lucide/svelte/icons/smartphone';
	import Usb from '@lucide/svelte/icons/usb';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import Pointer from '@lucide/svelte/icons/pointer';
	import ScanFace from '@lucide/svelte/icons/scan-face';
	import Copy from '@lucide/svelte/icons/copy';
	import Download from '@lucide/svelte/icons/download';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CeremonyShell from '../CeremonyShell.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import { totpEnrollInit, totpActivate, webauthnEnrollInit, webauthnActivate } from '$core/api/twofactor';
	import { createCredential, isWebauthnCancelled, webauthnSupported } from '$core/auth/webauthn';
	import { ApiCallError } from '$core/api/types';
	import { auth } from '$core/stores/auth.svelte';
	import { twofactor } from '$core/stores/twofactor.svelte';
	import type { CeremonyKind, TwoFaSetupMethod } from '../data';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
		initialMethod?: TwoFaSetupMethod;
	}

	let { onClose, onComplete, initialMethod }: Props = $props();

	const SETUP: Record<
		TwoFaSetupMethod,
		{ icon: typeof Smartphone; t: string; d: string; disabled?: boolean }
	> = $derived({
		totp: {
			icon: Smartphone,
			t: m.settings_ceremony_twofa_totp_title(),
			d: m.settings_ceremony_twofa_totp_desc()
		},
		key: {
			icon: Usb,
			t: m.settings_ceremony_twofa_key_title(),
			d: m.settings_ceremony_twofa_key_desc()
		},
		device: {
			icon: Fingerprint,
			t: m.settings_ceremony_twofa_device_title(),
			d: m.settings_ceremony_twofa_device_desc()
		}
	});

	function addTitle(kind: TwoFaSetupMethod): string {
		if (kind === 'totp') return m.settings_ceremony_twofa_add_totp();
		if (kind === 'key') return m.settings_ceremony_twofa_add_key();
		return m.settings_ceremony_twofa_add_device();
	}

	function onTitle(kind: TwoFaSetupMethod): string {
		if (kind === 'totp') return m.settings_ceremony_twofa_on_totp();
		if (kind === 'key') return m.settings_ceremony_twofa_on_key();
		return m.settings_ceremony_twofa_on_device();
	}

	let step = $derived(initialMethod ? 1 : 0);
	let method = $derived<TwoFaSetupMethod>(initialMethod ?? 'totp');
	let busy = $state(false);
	let setupError = $state('');
	let confirmed = $state(false);

	let otpauthUrl = $state('');
	let qrPngBase64 = $state('');
	let code = $state('');

	let backupCodes = $state<string[]>([]);
	let saved = $state(false);

	const totpActive = $derived(twofactor.status?.totp?.active === true);
	const manualSecret = $derived.by(() => {
		if (!otpauthUrl) return '';
		try {
			const secret = new URL(otpauthUrl).searchParams.get('secret') ?? '';
			return secret.replace(/(.{4})/g, '$1 ').trim();
		} catch {
			return '';
		}
	});

	const steps = $derived([
		m.settings_ceremony_twofa_step_method(),
		m.settings_ceremony_twofa_step_verify(),
		m.settings_ceremony_twofa_step_backup(),
		m.settings_ceremony_twofa_step_done()
	]);

	const methodOpts = $derived(
		(Object.entries(SETUP) as [TwoFaSetupMethod, (typeof SETUP)['totp']][]).map(([v, o]) => ({
			v,
			...o,
			disabled:
				(v === 'totp' && totpActive) || ((v === 'key' || v === 'device') && !webauthnSupported()),
			note:
				v === 'totp' && totpActive
					? m.settings_ceremony_twofa_note_active()
					: (v === 'key' || v === 'device') && !webauthnSupported()
						? m.settings_ceremony_twofa_note_unsupported()
						: null
		}))
	);

	async function beginSetup() {
		if (busy) return;
		busy = true;
		setupError = '';
		confirmed = false;
		try {
			if (method === 'totp') {
				const res = await totpEnrollInit(auth.accountId ?? undefined);
				otpauthUrl = res.otpauthUrl;
				qrPngBase64 = res.qrPngBase64;
				code = '';
			}
			step = 1;
		} catch (err) {
			console.warn('twofa: enroll init failed', err);
			setupError =
				err instanceof ApiCallError && err.status === 503
					? m.settings_ceremony_twofa_err_unavailable()
					: m.settings_ceremony_twofa_err_start();
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (initialMethod === 'totp' && step === 1 && !otpauthUrl && !busy && !setupError) {
			void beginSetup();
		}
	});

	async function activateTotp() {
		if (busy || code.length !== 6) return;
		busy = true;
		setupError = '';
		try {
			const res = await totpActivate({ code }, auth.accountId ?? undefined);
			finishActivation(res.backupCodes);
		} catch (err) {
			console.warn('twofa: totp activate failed', err);
			setupError =
				err instanceof ApiCallError && (err.status === 400 || err.status === 401)
					? m.settings_ceremony_twofa_err_mismatch()
					: m.settings_ceremony_twofa_err_verify();
			code = '';
		} finally {
			busy = false;
		}
	}

	async function registerKey() {
		if (busy || confirmed) return;
		busy = true;
		setupError = '';
		try {
			const init = await webauthnEnrollInit(auth.accountId ?? undefined);
			const options = init.publicKey as Record<string, unknown>;
			const selection = (options.authenticatorSelection as Record<string, unknown>) ?? {};
			options.authenticatorSelection = {
				...selection,
				authenticatorAttachment: method === 'device' ? 'platform' : 'cross-platform'
			};
			const credential = await createCredential(options);
			const res = await webauthnActivate(
				{
					registrationId: init.registrationId,
					credential,
					name: method === 'device' ? 'This device' : 'Security key'
				},
				auth.accountId ?? undefined
			);
			confirmed = true;
			backupCodes = res.backupCodes ?? [];
		} catch (err) {
			if (isWebauthnCancelled(err)) {
				busy = false;
				return;
			}
			console.warn('twofa: webauthn activate failed', err);
			setupError =
				err instanceof ApiCallError && err.status === 409
					? m.settings_ceremony_twofa_err_key_registered()
					: m.settings_ceremony_twofa_err_register();
		} finally {
			busy = false;
		}
	}

	function advanceFromVerify() {
		if (method === 'totp') {
			void activateTotp();
			return;
		}
		void twofactor.load(auth.accountId ?? undefined);
		if (backupCodes.length > 0) {
			saved = false;
			step = 2;
		} else {
			step = 3;
		}
	}

	function finishActivation(codes: string[] | undefined) {
		void twofactor.load(auth.accountId ?? undefined);
		if (codes && codes.length > 0) {
			backupCodes = codes;
			saved = false;
			step = 2;
		} else {
			step = 3;
		}
	}

	async function copyCodes() {
		try {
			await navigator.clipboard.writeText(backupCodes.join('\n'));
			saved = true;
		} catch (err) {
			console.warn('twofa: clipboard write failed', err);
		}
	}

	async function downloadCodes() {
		const lines = [
			'Thelemail two-factor backup codes',
			'=================================',
			'',
			`Account:   ${auth.email ?? ''}`,
			`Generated: ${new Date().toISOString().slice(0, 10)}`,
			'',
			'Each code signs you in once if you lose your second factor:',
			'',
			...backupCodes.map((c, i) => `  ${String(i + 1).padStart(2, ' ')}. ${c}`),
			'',
			'Keep these offline. Anyone with a code and your password can sign in.',
			''
		];
		const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
		await platform.saveBlob(blob, 'thelemail-backup-codes.txt');
		saved = true;
	}

	function finish() {
		backupCodes = [];
		onComplete('twofa');
		onClose();
	}
</script>

<CeremonyShell
	icon={ShieldCheck}
	eyebrow={m.settings_ceremony_twofa_eyebrow()}
	title={initialMethod ? addTitle(initialMethod) : m.settings_ceremony_twofa_title()}
	{steps}
	{step}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>{m.settings_ceremony_twofa_lede()}</p>
			</div>
			<div class="method-opts">
				{#each methodOpts as o (o.v)}
					{@const Ic = o.icon}
					<button
						type="button"
						class="method-opt"
						class:on={method === o.v}
						disabled={o.disabled}
						onclick={() => (method = o.v)}
					>
						<span class="mo-radio"><span></span></span>
						<Ic size={20} />
						<div class="mo-text">
							<div class="mo-t">{o.t}</div>
							<div class="mo-d">{o.note ?? o.d}</div>
						</div>
					</button>
				{/each}
			</div>
			{#if setupError}
				<span class="errtext"><CircleAlert size={13} /><span>{setupError}</span></span>
			{/if}
		</div>
	{:else if step === 1}
		{#if method === 'totp'}
			<div class="cer-pane two-col">
				<div class="qr">
					{#if qrPngBase64}
						<img
							class="qr-img"
							src={'data:image/png;base64,' + qrPngBase64}
							alt={m.settings_ceremony_twofa_qr_alt()}
						/>
					{/if}
				</div>
				<div class="qr-side">
					<div class="cer-instruct">
						{m.settings_ceremony_twofa_scan_instruct()}
					</div>
					{#if manualSecret}
						<div class="codeblock sm">
							<span class="v">{manualSecret}</span>
							<button
								type="button"
								class="cp"
								title={m.common_copy()}
								onclick={() => navigator.clipboard.writeText(manualSecret.replaceAll(' ', ''))}
							>
								<Copy size={14} />
							</button>
						</div>
					{/if}
					<div class="field">
						<label for="otp-code">{m.settings_ceremony_twofa_code_label()}</label>
						<input
							id="otp-code"
							class="tin mono otp"
							maxlength={6}
							inputmode="numeric"
							autocomplete="one-time-code"
							value={code}
							oninput={(e) =>
								(code = (e.currentTarget as HTMLInputElement).value.replace(/\D/g, ''))}
							onkeydown={(e) => {
								if (e.key === 'Enter') void activateTotp();
							}}
							placeholder="000000"
						/>
					</div>
					{#if setupError}
						<span class="errtext"><CircleAlert size={13} /><span>{setupError}</span></span>
					{/if}
				</div>
			</div>
		{:else}
			{@const isKey = method === 'key'}
			<div class="cer-pane center">
				<div class="webauthn" class:ok={confirmed}>
					{#if confirmed}<Check size={40} />
					{:else if isKey}<Usb size={40} />
					{:else}<Fingerprint size={40} />{/if}
				</div>
				<div class="cer-instruct center">
					{#if confirmed}
						{#if isKey}
							<span><Rich text={m.settings_ceremony_twofa_key_registered()} tags={{ b: bold }} /></span>
						{:else}
							<span><Rich text={m.settings_ceremony_twofa_device_registered()} tags={{ b: bold }} /></span>
						{/if}
					{:else if isKey}
						{m.settings_ceremony_twofa_key_instruct()}
					{:else}
						{m.settings_ceremony_twofa_device_instruct()}
					{/if}
				</div>
				{#if !confirmed}
					<Button variant="secondary" disabled={busy} onclick={registerKey}>
						{#if isKey}<Pointer size={15} />{:else}<ScanFace size={15} />{/if}
						{#if busy}
							{m.settings_ceremony_twofa_waiting()}
						{:else}
							{isKey ? m.settings_ceremony_twofa_touch_key() : m.settings_ceremony_twofa_use_touch_id()}
						{/if}
					</Button>
				{/if}
				{#if setupError}
					<span class="errtext"><CircleAlert size={13} /><span>{setupError}</span></span>
				{/if}
			</div>
		{/if}
	{:else if step === 2}
		<div class="cer-pane">
			<div class="cer-instruct">
				{method === 'totp'
					? m.settings_ceremony_twofa_backup_instruct_totp()
					: method === 'key'
						? m.settings_ceremony_twofa_backup_instruct_key()
						: m.settings_ceremony_twofa_backup_instruct_device()}
			</div>
			<div class="backup-grid">
				{#each backupCodes as c, i (i)}
					<div class="bc">
						<span class="bc-n">{i + 1}</span>
						<span class="bc-c">{c}</span>
					</div>
				{/each}
			</div>
			<div class="phrase-acts">
				<Button variant="secondary" size="sm" onclick={copyCodes}>
					<Copy size={14} />{m.common_copy()}
				</Button>
				<Button variant="secondary" size="sm" onclick={downloadCodes}>
					<Download size={14} />{m.settings_ceremony_twofa_download()}
				</Button>
				{#if saved}<span class="phrase-saved"><Check size={13} />{m.settings_ceremony_twofa_saved()}</span>{/if}
			</div>
		</div>
	{:else}
		<DoneScreen
			icon={ShieldCheck}
			title={onTitle(method)}
			desc={method === 'totp'
				? m.settings_ceremony_twofa_done_desc_totp()
				: method === 'key'
					? m.settings_ceremony_twofa_done_desc_key()
					: m.settings_ceremony_twofa_done_desc_device()}
		/>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" onclick={onClose}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={busy} onclick={beginSetup}>
				{#if busy}
					{m.settings_ceremony_twofa_preparing()}
				{:else}
					{m.common_continue()}<ArrowRight size={15} />
				{/if}
			</Button>
		{:else if step === 1}
			<Button variant="ghost" disabled={busy} onclick={() => (initialMethod ? onClose() : (step = 0))}>
				{#if initialMethod}
					{m.common_cancel()}
				{:else}
					<ArrowLeft size={15} />{m.common_back()}
				{/if}
			</Button>
			<Button variant="primary" disabled={busy || (method === 'totp' ? code.length < 6 : !confirmed)} onclick={advanceFromVerify}>
				{#if busy}
					{m.settings_ceremony_twofa_verifying()}
				{:else}
					{m.settings_ceremony_twofa_verify()}<ArrowRight size={15} />
				{/if}
			</Button>
		{:else if step === 2}
			<Button variant="primary" disabled={!saved} onclick={() => (step = 3)}>
				{m.settings_ceremony_twofa_saved_them()}<Check size={15} />
			</Button>
		{:else}
			<Button variant="primary" onclick={finish}>{m.common_done()}</Button>
		{/if}
	{/snippet}
</CeremonyShell>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}

<style>
	.qr-img {
		width: 168px;
		height: 168px;
		image-rendering: pixelated;
		border-radius: 8px;
	}
</style>
