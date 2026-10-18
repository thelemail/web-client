<script lang="ts">
	import KeySquare from '@lucide/svelte/icons/key-square';
	import Check from '@lucide/svelte/icons/check';
	import Info from '@lucide/svelte/icons/info';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CeremonyShell from '../CeremonyShell.svelte';
	import ProgressRun from '../ProgressRun.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import type { CeremonyKind } from '../data';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';
	import { auth } from '$core/stores/auth.svelte';
	import { accountKeys } from '$core/stores/accountKeys.svelte';
	import { keystore } from '$core/keystore/keystore-client';
	import type { PrepareKeyRotationFailureCode } from '$core/keystore/protocol';
	import { listMyKeys, rotateAccountKey } from '$core/api/me';
	import { listMyAddresses } from '$core/api/addresses';
	import { ApiCallError } from '$core/api/types';
	import { isReauthenticationRequired } from '$core/auth/reauth.svelte';
	import { withKeyLock } from '$core/keys/uid-sync';
	import { bytesToB64 } from '$core/keys/encode';
	import { formatFingerprintHex } from '$core/directory/format';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	let step = $state(0);
	let progress = $state(0);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let result = $state<{ previous: string; current: string } | null>(null);

	const steps = $derived([
		m.settings_ceremony_keys_step_rotate(),
		m.settings_ceremony_keys_step_publish(),
		m.settings_ceremony_keys_step_done()
	]);
	const lines = $derived([
		m.settings_ceremony_keys_line_generate(),
		m.settings_ceremony_keys_line_endorse(),
		m.settings_ceremony_keys_line_publish(),
		m.settings_ceremony_keys_line_save()
	]);

	const current = $derived(accountKeys.current);

	$effect(() => {
		if (auth.accountId) void accountKeys.ready(auth.accountId);
	});

	const blocked = $derived.by(() => {
		const blocker = auth.accountId ? auth.keyRotationBlockerFor(auth.accountId) : null;
		if (accountKeys.authScheme === 'srp_v1' || blocker === 'sign_in_upgrade_required') {
			return m.settings_security_rotate_blocked_sign_in();
		}
		return blocker === 'recovery_upgrade_required' ? m.settings_security_rotate_blocked_recovery() : null;
	});

	function prepareFailure(code: PrepareKeyRotationFailureCode): string {
		switch (code) {
			case 'not_opaque':
				return m.settings_security_rotate_blocked_sign_in();
			case 'stale_key_version':
			case 'key_history_incomplete':
				return m.settings_ceremony_keys_err_history();
			case 'locked':
				return m.settings_ceremony_keys_err_locked();
			default:
				return m.settings_ceremony_keys_err_failed();
		}
	}

	function apiFailure(err: ApiCallError): string {
		const code = err.envelope?.error?.code;
		if (code === 'account_key_stale') return m.settings_ceremony_keys_err_history();
		if (code === 'key_rotation_unavailable') return m.settings_ceremony_keys_err_unavailable();
		if (err.status === 429) return m.settings_ceremony_keys_err_too_soon();
		return m.settings_ceremony_keys_err_failed();
	}

	async function addressEmails(accountId: string): Promise<string[]> {
		const { addresses } = await listMyAddresses(accountId);
		return [...addresses].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)).map((a) => a.email);
	}

	async function rotate(accountId: string): Promise<'done' | 'cancelled'> {
		await accountKeys.load(accountId);
		const previous = accountKeys.current?.fingerprintHex ?? '';
		const [{ currentVersion }, emails] = await Promise.all([
			listMyKeys(accountId),
			addressEmails(accountId)
		]);
		const prepared = await keystore.prepareKeyRotation({ accountId, emails, expectedKeyVersion: currentVersion });
		if (!prepared.ok) throw new Error(prepareFailure(prepared.code));
		progress = 2;
		try {
			await rotateAccountKey(
				{
					expectedKeyVersion: currentVersion,
					publicKeyArmored: prepared.publicKeyArmored,
					encryptedPrivateKey: prepared.encryptedPrivateKey,
					transitions: prepared.transitions.map((t) => ({
						previousKeyFingerprint: t.previousKeyFingerprintHex,
						signature: bytesToB64(t.signature)
					}))
				},
				accountId
			);
		} catch (err) {
			if (isReauthenticationRequired(err)) {
				await keystore.abandonKeyRotation({ accountId });
				return 'cancelled';
			}
			if (err instanceof ApiCallError) {
				await keystore.abandonKeyRotation({ accountId });
				throw new Error(apiFailure(err));
			}
			await accountKeys.load(accountId);
			await keystore.abandonKeyRotation({ accountId });
			if (accountKeys.current?.fingerprintHex !== prepared.fingerprintHex) throw err;
			result = { previous, current: prepared.fingerprintHex };
			progress = 4;
			return 'done';
		}
		progress = 3;
		await keystore.commitKeyRotation({ accountId, fingerprintHex: prepared.fingerprintHex });
		await accountKeys.load(accountId);
		result = { previous, current: prepared.fingerprintHex };
		progress = 4;
		return 'done';
	}

	async function start() {
		const accountId = auth.accountId;
		if (!accountId || busy || blocked) return;
		busy = true;
		error = null;
		progress = 0;
		step = 1;
		try {
			progress = 1;
			const outcome = await withKeyLock(accountId, () => rotate(accountId));
			if (outcome === 'cancelled') {
				step = 0;
				return;
			}
			step = 2;
		} catch (err) {
			error = err instanceof Error && err.message ? err.message : m.settings_ceremony_keys_err_failed();
		} finally {
			busy = false;
		}
	}

	function finish() {
		onComplete('keys');
		onClose();
	}
</script>

<CeremonyShell
	icon={KeySquare}
	eyebrow={m.settings_ceremony_keys_eyebrow()}
	title={m.settings_ceremony_keys_title()}
	{steps}
	{step}
	onClose={busy ? () => {} : onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>{m.settings_ceremony_keys_lede()}</p>
			</div>
			<ul class="cer-points">
				<li><Check size={16} /><span>{m.settings_ceremony_keys_point_readable()}</span></li>
				<li><Info size={16} /><span>{m.settings_ceremony_keys_point_fingerprint()}</span></li>
				<li><MonitorSmartphone size={16} /><span>{m.settings_ceremony_keys_point_devices()}</span></li>
				<li><TriangleAlert size={16} /><span>{m.settings_ceremony_keys_point_old_apps()}</span></li>
			</ul>
			<div class="field">
				<span class="field-lbl">{m.settings_ceremony_keys_current_fingerprint()}</span>
				{#if current}
					<div class="codeblock sm"><span class="v">{formatFingerprintHex(current.fingerprintHex)}</span></div>
				{:else}
					<div class="field-hint">{m.settings_security_fingerprint_locked()}</div>
				{/if}
			</div>
			{#if blocked}
				<div class="field-hint bad"><CircleAlert size={13} />{blocked}</div>
			{/if}
		</div>
	{:else if step === 1}
		<div class="cer-pane">
			<ProgressRun label={m.settings_ceremony_keys_progress()} {lines} {progress} />
			{#if error}
				<div class="field-hint bad" role="alert"><CircleAlert size={13} />{error}</div>
			{/if}
		</div>
	{:else if result}
		<DoneScreen
			icon={KeySquare}
			title={m.settings_ceremony_keys_done_title()}
			desc={m.settings_ceremony_keys_done_desc()}
		>
			<div class="field" style:margin-top="18px">
				<span class="field-lbl">{m.settings_ceremony_keys_new_fingerprint()}</span>
				<div class="codeblock sm"><span class="v">{formatFingerprintHex(result.current)}</span></div>
			</div>
			{#if result.previous}
				<div class="field">
					<span class="field-lbl">{m.settings_ceremony_keys_previous_fingerprint()}</span>
					<div class="codeblock sm"><span class="v">{formatFingerprintHex(result.previous)}</span></div>
				</div>
			{/if}
		</DoneScreen>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" onclick={onClose}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={!!blocked || !current} onclick={start}>
				<RefreshCw size={15} />{m.settings_ceremony_keys_rotate()}
			</Button>
		{:else if step === 1 && error}
			<Button variant="ghost" onclick={onClose}>{m.common_cancel()}</Button>
			<Button variant="primary" onclick={start}>
				<RefreshCw size={15} />{m.common_retry()}
			</Button>
		{:else if step === 2}
			<Button variant="primary" onclick={finish}>{m.common_done()}</Button>
		{/if}
	{/snippet}
</CeremonyShell>
