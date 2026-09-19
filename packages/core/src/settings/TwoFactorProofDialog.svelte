<script lang="ts">
	import { m } from '$paraglide/messages.js';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import CeremonyShell from './CeremonyShell.svelte';
	import { webauthnProofInit } from '$core/api/twofactor';
	import { ApiCallError, type TwoFactorMethod, type TwoFactorProof } from '$core/api/types';
	import { getAssertion, isWebauthnCancelled, webauthnSupported } from '$core/auth/webauthn';
	import { auth } from '$core/stores/auth.svelte';
	import { Button } from '$core/components/ui/button';

	interface Props {
		title: string;
		desc: string;
		confirmLabel: string;
		methods: TwoFactorMethod[];
		danger?: boolean;
		onConfirm: (proof: TwoFactorProof) => Promise<void>;
		onClose: () => void;
	}

	let { title, desc, confirmLabel, methods, danger = false, onConfirm, onClose }: Props = $props();

	const hasTotp = $derived(methods.includes('totp'));
	const hasBackup = $derived(methods.includes('backupCode'));
	const hasWebauthn = $derived(methods.includes('webauthn') && webauthnSupported());

	let mode = $derived<'totp' | 'backup'>(hasTotp ? 'totp' : 'backup');
	let code = $state('');
	let busy = $state(false);
	let error = $state('');

	const codeReady = $derived(
		mode === 'totp' ? /^\d{6}$/.test(code) : code.trim().length > 0
	);

	async function run(proof: TwoFactorProof) {
		busy = true;
		error = '';
		try {
			await onConfirm(proof);
		} catch (err) {
			if (isWebauthnCancelled(err)) {
				busy = false;
				return;
			}
			console.warn('twofa: proof confirm failed', err);
			error =
				err instanceof ApiCallError && err.status === 401
					? m.settings_security_proof_invalid()
					: err instanceof ApiCallError && err.status === 503
						? m.settings_security_proof_unavailable()
						: m.common_something_went_wrong();
			code = '';
			busy = false;
		}
	}

	function submitCode() {
		if (busy || !codeReady) return;
		void run(
			mode === 'totp'
				? { method: 'totp', code }
				: { method: 'backupCode', code: code.trim() }
		);
	}

	async function submitWebauthn() {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const init = await webauthnProofInit(auth.accountId ?? undefined);
			const credential = await getAssertion(init.publicKey);
			busy = false;
			await run({ method: 'webauthn', proofToken: init.registrationId, credential });
		} catch (err) {
			if (isWebauthnCancelled(err)) {
				busy = false;
				return;
			}
			console.warn('twofa: webauthn proof failed', err);
			error = m.settings_security_proof_key_failed();
			busy = false;
		}
	}
</script>

<CeremonyShell
	icon={ShieldCheck}
	eyebrow={m.settings_security_proof_eyebrow()}
	{title}
	tone={danger ? 'danger' : undefined}
	{onClose}
>
	<div class="cer-pane">
		<div class="cer-lede"><p>{desc}</p></div>
		<div class="field">
			<label for="proof-code">
				{mode === 'totp' ? m.settings_security_proof_totp_label() : m.settings_security_proof_backup_label()}
			</label>
			<input
				id="proof-code"
				class="tin mono otp"
				maxlength={mode === 'totp' ? 6 : 12}
				inputmode={mode === 'totp' ? 'numeric' : 'text'}
				autocomplete={mode === 'totp' ? 'one-time-code' : 'off'}
				spellcheck={false}
				disabled={busy}
				value={code}
				oninput={(e) => {
					const v = (e.currentTarget as HTMLInputElement).value;
					code = mode === 'totp' ? v.replace(/\D/g, '') : v;
				}}
				onkeydown={(e) => {
					if (e.key === 'Enter') submitCode();
				}}
				placeholder={mode === 'totp' ? '000000' : 'XXXX-XXXX'}
			/>
		</div>
		{#if hasTotp && hasBackup}
			<button
				type="button"
				class="linklike"
				disabled={busy}
				onclick={() => {
					mode = mode === 'totp' ? 'backup' : 'totp';
					code = '';
					error = '';
				}}
			>
				{mode === 'totp' ? m.settings_security_proof_use_backup() : m.settings_security_proof_use_totp()}
			</button>
		{/if}
		{#if hasWebauthn}
			<Button variant="secondary" size="sm" disabled={busy} onclick={submitWebauthn}>
				<Fingerprint size={14} />{m.settings_security_proof_use_key()}
			</Button>
		{/if}
		{#if error}
			<span class="errtext"><CircleAlert size={13} /><span>{error}</span></span>
		{/if}
	</div>

	{#snippet footer()}
		<Button variant="ghost" disabled={busy} onclick={onClose}>{m.common_cancel()}</Button>
		<Button
			variant={danger ? 'danger' : 'primary'}
			disabled={busy || !codeReady}
			onclick={submitCode}
		>
			{#if busy}
				{m.settings_security_proof_verifying()}
			{:else}
				{confirmLabel}
			{/if}
		</Button>
	{/snippet}
</CeremonyShell>
