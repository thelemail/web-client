<script lang="ts">
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
	import { totpEnrollInit, totpActivate, webauthnEnrollInit, webauthnActivate } from '$lib/api/twofactor';
	import { createCredential, isWebauthnCancelled, webauthnSupported } from '$lib/auth/webauthn';
	import { ApiCallError } from '$lib/api/types';
	import { auth } from '$lib/stores/auth.svelte';
	import { twofactor } from '$lib/stores/twofactor.svelte';
	import type { CeremonyKind, TwoFaSetupMethod } from '../data';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
		initialMethod?: TwoFaSetupMethod;
	}

	let { onClose, onComplete, initialMethod }: Props = $props();

	const SETUP: Record<
		TwoFaSetupMethod,
		{ icon: typeof Smartphone; t: string; d: string; disabled?: boolean }
	> = {
		totp: {
			icon: Smartphone,
			t: 'Authenticator app',
			d: 'A 6-digit code from an app like Aegis or 1Password.'
		},
		key: {
			icon: Usb,
			t: 'Security key',
			d: 'A YubiKey or any FIDO2 hardware key, via WebAuthn.'
		},
		device: {
			icon: Fingerprint,
			t: 'This device',
			d: 'Touch ID, Face ID, or your screen lock — a passkey kept on this device.'
		}
	};

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

	const steps = ['Method', 'Verify', 'Backup codes', 'Done'];
	const M = $derived(SETUP[method]);

	const methodOpts = $derived(
		(Object.entries(SETUP) as [TwoFaSetupMethod, (typeof SETUP)['totp']][]).map(([v, o]) => ({
			v,
			...o,
			disabled:
				(v === 'totp' && totpActive) || ((v === 'key' || v === 'device') && !webauthnSupported()),
			note:
				v === 'totp' && totpActive
					? 'Already active on this account.'
					: (v === 'key' || v === 'device') && !webauthnSupported()
						? 'Not supported by this browser.'
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
					? 'The code service is temporarily unavailable. Try again in a moment.'
					: 'Could not start enrollment. Check your connection and retry.';
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
					? 'That code didn’t match. Codes rotate every 30 seconds — try the current one.'
					: 'Could not verify the code. Try again.';
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
					? 'This key is already registered on an account.'
					: 'Could not register. Try again.';
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

	function downloadCodes() {
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
		const url = URL.createObjectURL(blob);
		try {
			const a = document.createElement('a');
			a.href = url;
			a.download = 'thelemail-backup-codes.txt';
			document.body.appendChild(a);
			a.click();
			a.remove();
			saved = true;
		} finally {
			setTimeout(() => URL.revokeObjectURL(url), 10_000);
		}
	}

	function finish() {
		backupCodes = [];
		onComplete('twofa');
		onClose();
	}
</script>

<CeremonyShell
	icon={ShieldCheck}
	eyebrow="Security · ceremony"
	title={initialMethod ? 'Add ' + SETUP[initialMethod].t.toLowerCase() : 'Two-factor authentication'}
	{steps}
	{step}
	{onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					Add a second step at sign-in. Choose how you’ll confirm it’s you — you can enrol more
					than one method, and any of them will do at the door.
				</p>
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
							alt="Authenticator QR code"
						/>
					{/if}
				</div>
				<div class="qr-side">
					<div class="cer-instruct">
						Scan with your authenticator, or enter the key by hand:
					</div>
					{#if manualSecret}
						<div class="codeblock sm">
							<span class="v">{manualSecret}</span>
							<button
								type="button"
								class="cp"
								title="Copy"
								onclick={() => navigator.clipboard.writeText(manualSecret.replaceAll(' ', ''))}
							>
								<Copy size={14} />
							</button>
						</div>
					{/if}
					<div class="field">
						<label for="otp-code">Enter the 6-digit code</label>
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
							<span><b>Key registered.</b> It’ll work in any USB port — and over NFC.</span>
						{:else}
							<span><b>This device is registered.</b> Your fingerprint or face never leaves it.</span>
						{/if}
					{:else if isKey}
						Insert your security key and touch the contact when it blinks.
					{:else}
						Follow your device’s prompt — Touch ID, Face ID, or your screen lock.
					{/if}
				</div>
				{#if !confirmed}
					<button type="button" class="btn btn-secondary" disabled={busy} onclick={registerKey}>
						{#if isKey}<Pointer size={15} />{:else}<ScanFace size={15} />{/if}
						{#if busy}
							Waiting&hellip;
						{:else}
							{isKey ? 'Touch the key' : 'Use Touch ID'}
						{/if}
					</button>
				{/if}
				{#if setupError}
					<span class="errtext"><CircleAlert size={13} /><span>{setupError}</span></span>
				{/if}
			</div>
		{/if}
	{:else if step === 2}
		<div class="cer-pane">
			<div class="cer-instruct">
				Save these one-time backup codes. Each works once if you lose your
				{method === 'totp' ? 'authenticator' : method === 'key' ? 'key' : 'device'}.
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
				<button type="button" class="btn btn-secondary btn-sm" onclick={copyCodes}>
					<Copy size={14} />Copy
				</button>
				<button type="button" class="btn btn-secondary btn-sm" onclick={downloadCodes}>
					<Download size={14} />Download
				</button>
				{#if saved}<span class="phrase-saved"><Check size={13} />Saved</span>{/if}
			</div>
		</div>
	{:else}
		<DoneScreen
			icon={ShieldCheck}
			title={M.t + ' is on'}
			desc={method === 'totp'
				? 'You’ll confirm with a code from your authenticator when you sign in.'
				: method === 'key'
					? 'You’ll confirm with a touch of your key when you sign in.'
					: 'You’ll confirm with Touch ID, Face ID, or your screen lock when you sign in here.'}
		/>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<button type="button" class="btn btn-ghost" onclick={onClose}>Cancel</button>
			<button type="button" class="btn btn-primary" disabled={busy} onclick={beginSetup}>
				{#if busy}
					Preparing&hellip;
				{:else}
					Continue<ArrowRight size={15} />
				{/if}
			</button>
		{:else if step === 1}
			<button
				type="button"
				class="btn btn-ghost"
				disabled={busy}
				onclick={() => (initialMethod ? onClose() : (step = 0))}
			>
				{#if initialMethod}
					Cancel
				{:else}
					<ArrowLeft size={15} />Back
				{/if}
			</button>
			<button
				type="button"
				class="btn btn-primary"
				disabled={busy || (method === 'totp' ? code.length < 6 : !confirmed)}
				onclick={advanceFromVerify}
			>
				{#if busy}
					Verifying&hellip;
				{:else}
					Verify<ArrowRight size={15} />
				{/if}
			</button>
		{:else if step === 2}
			<button type="button" class="btn btn-primary" disabled={!saved} onclick={() => (step = 3)}>
				I’ve saved them<Check size={15} />
			</button>
		{:else}
			<button type="button" class="btn btn-primary" onclick={finish}>Done</button>
		{/if}
	{/snippet}
</CeremonyShell>

<style>
	.qr-img {
		width: 168px;
		height: 168px;
		image-rendering: pixelated;
		border-radius: 8px;
	}
</style>
