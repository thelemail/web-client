<script lang="ts">
	import { onMount } from 'svelte';
	import { m } from '$paraglide/messages.js';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import ConfirmDialog from '$core/mail/ConfirmDialog.svelte';
	import { Button } from '$core/components/ui/button';
	import { getTwoFactorStatus } from '$core/api/twofactor';
	import { ApiCallError, type TwoFactorMethod, type TwoFactorProof } from '$core/api/types';
	import { codeProof, enrolledMethods, webauthnProof } from '$core/auth/two-factor-proof';
	import { isWebauthnCancelled, webauthnSupported } from '$core/auth/webauthn';
	import { BACKUP_CODE_MAX_LENGTH, BACKUP_CODE_PLACEHOLDER } from '$core/auth/backup-codes';
	import { auth } from '$core/stores/auth.svelte';
	import { reauth } from './reauth.svelte';
	import { sessionStepUp } from './session-step-up';

	interface Props {
		accountId: string;
	}

	let { accountId }: Props = $props();

	let methods = $state<TwoFactorMethod[] | null>(null);
	let password = $state('');
	let code = $state('');
	let busy = $state(false);
	let error = $state('');

	onMount(() => {
		let live = true;
		getTwoFactorStatus(accountId)
			.then((status) => {
				if (live) methods = enrolledMethods(status);
			})
			.catch((err) => {
				console.warn('reauth: could not load sign-in methods', err);
				if (live) error = m.settings_ceremony_twofa_err_network();
			});
		return () => {
			live = false;
		};
	});

	const hasTotp = $derived(methods?.includes('totp') ?? false);
	const hasBackup = $derived(methods?.includes('backupCode') ?? false);
	const hasWebauthn = $derived((methods?.includes('webauthn') ?? false) && webauthnSupported());
	const needsFactor = $derived(
		(methods?.includes('totp') ?? false) || (methods?.includes('webauthn') ?? false)
	);
	const needsCode = $derived(needsFactor && (hasTotp || hasBackup));
	let mode = $derived<'totp' | 'backup'>(hasTotp ? 'totp' : 'backup');
	const codeReady = $derived(mode === 'totp' ? /^\d{6}$/.test(code) : code.trim().length > 0);
	const canSubmit = $derived(
		methods !== null && password.length > 0 && (!needsFactor || (needsCode && codeReady))
	);

	async function submit(proof: () => Promise<TwoFactorProof | null>) {
		if (busy) return;
		busy = true;
		error = '';
		const proofSent = needsFactor;
		try {
			const res = await sessionStepUp({ accountId, password, proof });
			if (!res.ok) {
				error =
					res.reason === 'scheme'
						? m.settings_ceremony_twofa_err_upgrade()
						: m.settings_ceremony_twofa_err_password();
				return;
			}
			await auth.adoptSteppedUpToken(res.session);
			reauth.settle(true);
		} catch (err) {
			if (isWebauthnCancelled(err)) return;
			console.warn('reauth: step-up failed', err);
			if (err instanceof ApiCallError && err.status === 401) {
				error = proofSent
					? m.settings_ceremony_twofa_err_not_verified()
					: m.settings_ceremony_twofa_err_password();
				code = '';
			} else if (err instanceof ApiCallError && err.status === 429) {
				error = m.settings_ceremony_twofa_err_locked();
			} else if (err instanceof ApiCallError && err.status === 409) {
				error = m.settings_ceremony_twofa_err_upgrade();
			} else {
				error = m.settings_ceremony_twofa_err_network();
			}
		} finally {
			busy = false;
		}
	}

	function submitCode() {
		if (!canSubmit) return;
		void submit(() => Promise.resolve(needsFactor ? codeProof(mode, code) : null));
	}

	function submitKey() {
		if (busy || password.length === 0) return;
		void submit(() => webauthnProof(accountId));
	}

	function cancel() {
		if (busy) return;
		reauth.settle(false);
	}
</script>

{#snippet form()}
	<p class="cfd-p">{needsFactor ? m.reauth_lede_factor() : m.reauth_lede()}</p>
	<div class="cfd-field reauth-field">
		<label class="cfd-label" for="reauth-password">{m.settings_ceremony_twofa_password()}</label>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			id="reauth-password"
			class="cfd-input"
			type="password"
			autocomplete="current-password"
			autofocus
			placeholder={m.settings_ceremony_twofa_password_placeholder()}
			disabled={busy}
			bind:value={password}
			onkeydown={(e) => {
				if (e.key === 'Enter') submitCode();
			}}
		/>
	</div>
	{#if needsCode}
		<div class="cfd-field reauth-field">
			<label class="cfd-label" for="reauth-code">
				{mode === 'totp'
					? m.settings_ceremony_twofa_authenticator_code()
					: m.settings_ceremony_twofa_backup_code()}
			</label>
			<input
				id="reauth-code"
				class="cfd-input cfd-mono"
				maxlength={mode === 'totp' ? 6 : BACKUP_CODE_MAX_LENGTH}
				inputmode={mode === 'totp' ? 'numeric' : 'text'}
				autocomplete={mode === 'totp' ? 'one-time-code' : 'off'}
				spellcheck={false}
				disabled={busy}
				value={code}
				placeholder={mode === 'totp' ? '000000' : BACKUP_CODE_PLACEHOLDER}
				oninput={(e) => {
					const v = (e.currentTarget as HTMLInputElement).value;
					code = mode === 'totp' ? v.replace(/\D/g, '') : v.toUpperCase();
				}}
				onkeydown={(e) => {
					if (e.key === 'Enter') submitCode();
				}}
			/>
		</div>
	{/if}
	{#if hasTotp && hasBackup}
		<Button
			variant="ghost"
			size="sm"
			disabled={busy}
			onclick={() => {
				mode = mode === 'totp' ? 'backup' : 'totp';
				code = '';
				error = '';
			}}
		>
			{mode === 'totp'
				? m.settings_ceremony_twofa_use_backup()
				: m.settings_ceremony_twofa_use_authenticator()}
		</Button>
	{/if}
	{#if hasWebauthn}
		<Button variant="secondary" size="sm" disabled={busy || password.length === 0} onclick={submitKey}>
			<Fingerprint size={14} />{m.settings_ceremony_twofa_use_security_key()}
		</Button>
	{/if}
	{#if needsFactor && !needsCode && !hasWebauthn}
		<p class="cfd-hint">{m.settings_ceremony_twofa_confirm_no_method()}</p>
	{/if}
{/snippet}

<div class="reauth-layer">
	<ConfirmDialog
		icon={ShieldCheck}
		title={m.reauth_title()}
		confirmLabel={m.reauth_continue()}
		{busy}
		disabled={!canSubmit}
		error={error || null}
		body={form}
		onConfirm={submitCode}
		onClose={cancel}
	/>
</div>

<style>
	.reauth-layer :global(.cfd-scrim) {
		z-index: 1100;
	}

	.reauth-field {
		margin-bottom: 12px;
	}
</style>
