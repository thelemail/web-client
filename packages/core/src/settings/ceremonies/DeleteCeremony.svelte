<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Globe from '@lucide/svelte/icons/globe';
	import Users from '@lucide/svelte/icons/users';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Download from '@lucide/svelte/icons/download';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import LogOut from '@lucide/svelte/icons/log-out';
	import { goto } from '$app/navigation';
	import CeremonyShell from '../CeremonyShell.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import { confirmDeletion, confirmDeletionOpaque, initDeletion, initDeletionOpaque } from '$core/api/deletion';
	import { webauthnProofInit } from '$core/api/twofactor';
	import { ApiCallError, type TwoFactorMethod, type TwoFactorProof } from '$core/api/types';
	import { getAssertion, isWebauthnCancelled, webauthnSupported } from '$core/auth/webauthn';
	import { keystore } from '$core/keystore/keystore-client';
	import { accounts } from '$core/stores/accounts.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { twofactor } from '$core/stores/twofactor.svelte';
	import type { CeremonyKind } from '../data';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	let step = $state(0);
	let confirmText = $state('');
	let ackA = $state(false);
	let ackB = $state(false);
	let cur = $state('');
	let busy = $state(false);
	let verifyError = $state('');
	let workspaceBlocked = $state(false);
	let twoFaMode = $state<'totp' | 'backup'>('totp');
	let twoFaCode = $state('');
	let purgeAt = $state('');
	let signingOut = $state(false);

	const target = $derived(auth.email ?? '');
	const canContinue = $derived(target !== '' && confirmText.trim() === target && ackA && ackB);
	const steps = $derived([
		m.settings_ceremony_delete_step_warning(),
		m.settings_ceremony_delete_step_confirm(),
		m.settings_ceremony_delete_step_verify(),
		m.settings_ceremony_delete_step_scheduled()
	]);

	$effect(() => {
		if (auth.accountId && twofactor.status === null && !twofactor.loading) {
			void twofactor.load();
		}
	});

	const methods = $derived.by<TwoFactorMethod[]>(() => {
		const st = twofactor.status;
		if (!st) return [];
		const out: TwoFactorMethod[] = [];
		if (st.totp?.active) out.push('totp');
		if (st.webauthnCredentials.length > 0) out.push('webauthn');
		if ((st.backupCodes?.remaining ?? 0) > 0) out.push('backupCode');
		return out;
	});
	const hasTotp = $derived(methods.includes('totp'));
	const hasBackup = $derived(methods.includes('backupCode'));
	const hasWebauthn = $derived(methods.includes('webauthn') && webauthnSupported());
	const needsCode = $derived(hasTotp || hasBackup);
	const codeReady = $derived(
		twoFaMode === 'totp' ? /^\d{6}$/.test(twoFaCode) : twoFaCode.trim().length > 0
	);
	const canSubmit = $derived(
		cur.length > 0 && (methods.length === 0 || (needsCode ? codeReady : false))
	);

	const purgeDateLabel = $derived(
		purgeAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(purgeAt)) : ''
	);

	function inlineProof(): TwoFactorProof | null {
		if (methods.length === 0) return null;
		return twoFaMode === 'totp'
			? { method: 'totp', code: twoFaCode }
			: { method: 'backupCode', code: twoFaCode.trim() };
	}

	async function webauthnProof(): Promise<TwoFactorProof> {
		const init = await webauthnProofInit(auth.accountId ?? undefined);
		const credential = await getAssertion(init.publicKey);
		return { method: 'webauthn', proofToken: init.registrationId, credential };
	}

	async function submitDeletion(getProof: () => Promise<TwoFactorProof | null>) {
		if (busy) return;
		const accountId = auth.accountId;
		if (!accountId) return;
		busy = true;
		verifyError = '';
		let proofSent = false;
		try {
			const status = await keystore.status();
			const scheme = status.accounts.find((a) => a.accountId === accountId)?.authScheme ?? 'srp_v1';
			if (scheme === 'opaque_v1') {
				const start = await keystore.opaqueStartAuth({ password: cur });
				const init = await initDeletionOpaque({ ke1: start.ke1 }, accountId);
				const finish = await keystore.opaqueFinishAuth({
					operationId: start.operationId,
					accountId,
					ke2: init.ke2
				});
				if (!finish.ok) {
					verifyError = m.settings_ceremony_delete_err_password();
					return;
				}
				const proof = await getProof();
				proofSent = proof !== null;
				const res = await confirmDeletionOpaque(
					{ challengeId: init.challengeId, ke3: finish.ke3, ...(proof ? { proof } : {}) },
					accountId
				);
				purgeAt = res.purgeAt;
				step = 3;
				return;
			}
			const init = await initDeletion(accountId);
			const proofs = await keystore.prepareDeletionProof({
				accountId,
				password: cur,
				modulus: init.modulus,
				salt: init.salt,
				serverPublicEphemeral: init.serverPublicEphemeral
			});
			if (!proofs.ok) {
				verifyError = m.settings_ceremony_delete_err_locked();
				return;
			}
			const proof = await getProof();
			proofSent = proof !== null;
			const res = await confirmDeletion(
				{
					challengeId: init.challengeId,
					clientPublicEphemeral: proofs.clientPublicEphemeral,
					clientProof: proofs.clientProof,
					...(proof ? { proof } : {})
				},
				accountId
			);
			if (res.serverProof !== proofs.expectedServerProof) {
				verifyError = m.settings_ceremony_delete_err_server_proof();
				return;
			}
			purgeAt = res.purgeAt;
			step = 3;
		} catch (err) {
			if (isWebauthnCancelled(err)) return;
			console.warn('account deletion: confirm failed', err);
			if (err instanceof ApiCallError) {
				const code = err.envelope?.error?.code;
				if (code === 'workspace_transfer_required') {
					workspaceBlocked = true;
				} else if (err.status === 401) {
					verifyError = proofSent
						? m.settings_ceremony_delete_err_not_verified()
						: m.settings_ceremony_delete_err_password();
					twoFaCode = '';
				} else if (err.status === 409) {
					verifyError = m.settings_ceremony_delete_err_already_scheduled();
				} else if (err.status === 429) {
					verifyError = m.settings_ceremony_delete_err_rate_limited();
				} else {
					verifyError = m.settings_ceremony_delete_err_network();
				}
			} else {
				verifyError = m.settings_ceremony_delete_err_network();
			}
		} finally {
			busy = false;
		}
	}

	function submit() {
		if (!canSubmit) return;
		void submitDeletion(() => Promise.resolve(inlineProof()));
	}

	function submitWithWebauthn() {
		if (busy || cur.length === 0) return;
		void submitDeletion(webauthnProof);
	}

	async function signOutDeleted() {
		if (signingOut) return;
		signingOut = true;
		const id = auth.accountId;
		if (id) await auth.logoutAccount(id);
		const remaining = accounts.list[0];
		if (remaining) {
			auth.activate(remaining.accountId);
			await goto(`/u/${remaining.slot}/mail/inbox`);
		} else {
			await goto('/login');
		}
	}
</script>

<CeremonyShell
	icon={CircleAlert}
	eyebrow={m.settings_ceremony_delete_eyebrow()}
	title={m.settings_ceremony_delete_title()}
	tone="danger"
	{steps}
	{step}
	onClose={step === 3 ? signOutDeleted : onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					<Rich text={m.settings_ceremony_delete_lede({ email: target })} tags={{ addr: mono }} />
				</p>
			</div>
			<ul class="cer-points danger">
				<li><Trash2 size={16} /><span>{m.settings_ceremony_delete_point_erased()}</span></li>
				<li><Globe size={16} /><span>{m.settings_ceremony_delete_point_domains()}</span></li>
				<li><CalendarClock size={16} /><span>{m.settings_ceremony_delete_point_signed_out()}</span></li>
			</ul>
			<div class="export-nudge">
				<Download size={17} />
				<div><Rich text={m.settings_ceremony_delete_export_nudge()} tags={{ b: bold }} /></div>
				<Button variant="secondary" size="sm">{m.settings_ceremony_delete_export_archive()}</Button>
			</div>
		</div>
	{:else if step === 1}
		<div class="cer-pane">
			<label class="cer-ack danger">
				<input type="checkbox" bind:checked={ackA} />
				<span>{m.settings_ceremony_delete_ack_destroyed()}</span>
			</label>
			<label class="cer-ack danger">
				<input type="checkbox" bind:checked={ackB} />
				<span>{m.settings_ceremony_delete_ack_exported()}</span>
			</label>
			<div class="field">
				<label for="del-confirm"
					><Rich
						text={m.settings_ceremony_delete_type_to_confirm({ email: target })}
						tags={{ addr: mono }}
					/></label
				>
				<input
					id="del-confirm"
					class="tin mono"
					bind:value={confirmText}
					placeholder={target}
					autocomplete="off"
				/>
			</div>
		</div>
	{:else if step === 2}
		{#if workspaceBlocked}
			<div class="cer-pane">
				<div class="cer-lede">
					<p>{m.settings_ceremony_delete_workspace_lede()}</p>
				</div>
				<ul class="cer-points danger">
					<li><Users size={16} /><span>{m.settings_ceremony_delete_workspace_point()}</span></li>
				</ul>
			</div>
		{:else}
			<div class="cer-pane">
				<div class="cer-lede">
					<p>{m.settings_ceremony_delete_verify_lede()}</p>
				</div>
				<div class="field">
					<label for="del-pw">{m.settings_ceremony_delete_current_password()}</label>
					<input
						id="del-pw"
						class="tin"
						type="password"
						bind:value={cur}
						placeholder={m.settings_ceremony_delete_current_password_placeholder()}
						autocomplete="current-password"
						disabled={busy}
						onkeydown={(e) => {
							if (e.key === 'Enter' && canSubmit) submit();
						}}
					/>
				</div>
				{#if needsCode}
					<div class="field">
						<label for="del-2fa-code">
							{twoFaMode === 'totp'
								? m.settings_ceremony_delete_authenticator_code()
								: m.settings_ceremony_delete_backup_code()}
						</label>
						<input
							id="del-2fa-code"
							class="tin mono otp"
							maxlength={twoFaMode === 'totp' ? 6 : 12}
							inputmode={twoFaMode === 'totp' ? 'numeric' : 'text'}
							autocomplete={twoFaMode === 'totp' ? 'one-time-code' : 'off'}
							spellcheck={false}
							disabled={busy}
							value={twoFaCode}
							oninput={(e) => {
								const v = (e.currentTarget as HTMLInputElement).value;
								twoFaCode = twoFaMode === 'totp' ? v.replace(/\D/g, '') : v;
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' && canSubmit) submit();
							}}
							placeholder={twoFaMode === 'totp' ? '000000' : 'XXXX-XXXX'}
						/>
					</div>
				{/if}
				{#if hasTotp && hasBackup}
					<button
						type="button"
						class="linklike"
						disabled={busy}
						onclick={() => {
							twoFaMode = twoFaMode === 'totp' ? 'backup' : 'totp';
							twoFaCode = '';
							verifyError = '';
						}}
					>
						{twoFaMode === 'totp'
							? m.settings_ceremony_delete_use_backup()
							: m.settings_ceremony_delete_use_authenticator()}
					</button>
				{/if}
				{#if hasWebauthn}
					<Button variant="secondary" size="sm" disabled={busy || cur.length === 0} onclick={submitWithWebauthn}>
						<Fingerprint size={14} />{m.settings_ceremony_delete_use_security_key()}
					</Button>
				{/if}
				{#if verifyError}
					<span class="errtext"><CircleAlert size={13} /><span>{verifyError}</span></span>
				{/if}
			</div>
		{/if}
	{:else}
		<DoneScreen
			icon={CircleCheck}
			title={m.settings_ceremony_delete_done_title()}
			desc={m.settings_ceremony_delete_done_desc({ date: purgeDateLabel })}
		/>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" onclick={onClose}>{m.settings_ceremony_delete_keep()}</Button>
			<Button variant="danger" onclick={() => (step = 1)}>
				{m.common_continue()}<ArrowRight size={15} />
			</Button>
		{:else if step === 1}
			<Button variant="ghost" onclick={() => (step = 0)}>
				<ArrowLeft size={15} />{m.common_back()}
			</Button>
			<Button variant="danger" disabled={!canContinue} onclick={() => (step = 2)}>
				{m.common_continue()}<ArrowRight size={15} />
			</Button>
		{:else if step === 2}
			{#if workspaceBlocked}
				<Button variant="primary" onclick={onClose}>{m.settings_ceremony_delete_open_settings()}</Button>
			{:else}
				<Button variant="ghost" disabled={busy} onclick={() => (step = 1)}>
					<ArrowLeft size={15} />{m.common_back()}
				</Button>
				<Button variant="danger" disabled={busy || !canSubmit} onclick={submit}>
					{#if busy}
						{m.settings_ceremony_delete_verifying()}
					{:else}
						<Trash2 size={15} />{m.settings_ceremony_delete_submit()}
					{/if}
				</Button>
			{/if}
		{:else}
			<Button variant="primary" disabled={signingOut} onclick={signOutDeleted}>
				<LogOut size={15} />{signingOut
					? m.settings_ceremony_delete_signing_out()
					: m.settings_ceremony_delete_sign_out()}
			</Button>
		{/if}
	{/snippet}
</CeremonyShell>

{#snippet mono(t: string)}<span class="mono">{t}</span>{/snippet}
{#snippet bold(t: string)}<b>{t}</b>{/snippet}

<style>
	.linklike {
		background: none;
		border: none;
		padding: 0;
		font: inherit;
		font-size: 12.5px;
		color: var(--link, var(--pine-700));
		font-weight: 500;
		cursor: pointer;
		align-self: flex-start;
	}
	.linklike:hover {
		text-decoration: underline;
	}
</style>
