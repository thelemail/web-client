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
	import { confirmDeletion, confirmDeletionOpaque, initDeletion, initDeletionOpaque } from '$lib/api/deletion';
	import { webauthnProofInit } from '$lib/api/twofactor';
	import { ApiCallError, type TwoFactorMethod, type TwoFactorProof } from '$lib/api/types';
	import { getAssertion, isWebauthnCancelled, webauthnSupported } from '$lib/auth/webauthn';
	import { keystore } from '$lib/keystore/keystore-client';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { twofactor } from '$lib/stores/twofactor.svelte';
	import type { CeremonyKind } from '../data';
	import { Button } from '$lib/components/ui/button';

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
	const steps = ['Warning', 'Confirm', 'Verify', 'Scheduled'];

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
					verifyError = 'That password is incorrect.';
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
				verifyError = 'Your mailbox is locked on this device. Sign in again, then retry.';
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
				verifyError = 'Could not verify the server. Please try again.';
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
						? 'That didn’t verify — check the password and the code, then try again.'
						: 'That password is incorrect.';
					twoFaCode = '';
				} else if (err.status === 409) {
					verifyError = 'A deletion is already scheduled for this account.';
				} else if (err.status === 429) {
					verifyError = 'Too many attempts. Wait a few minutes and try again.';
				} else {
					verifyError = 'Could not reach the server — check your connection and retry.';
				}
			} else {
				verifyError = 'Could not reach the server — check your connection and retry.';
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
	eyebrow="Account · ceremony"
	title="Delete account"
	tone="danger"
	{steps}
	{step}
	onClose={step === 3 ? signOutDeleted : onClose}
>
	{#if step === 0}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					Deleting <span class="mono">{target}</span> deactivates it immediately and erases
					everything after a 30-day grace period. Because your mail is encrypted at rest, once it
					is purged it is gone — not recoverable by us or by you.
				</p>
			</div>
			<ul class="cer-points danger">
				<li><Trash2 size={16} /><span>Every message, alias, and contact on this account will be erased.</span></li>
				<li><Globe size={16} /><span>Domains stay yours — but mail stops routing until you reconnect them.</span></li>
				<li><CalendarClock size={16} /><span>You are signed out everywhere now. You can change your mind by logging back in within 30 days.</span></li>
			</ul>
			<div class="export-nudge">
				<Download size={17} />
				<div><b>Export first.</b> Take your archive with you before it’s gone.</div>
				<Button variant="secondary" size="sm">Export archive</Button>
			</div>
		</div>
	{:else if step === 1}
		<div class="cer-pane">
			<label class="cer-ack danger">
				<input type="checkbox" bind:checked={ackA} />
				<span>I understand my mail is encrypted and will be permanently destroyed after the grace period.</span>
			</label>
			<label class="cer-ack danger">
				<input type="checkbox" bind:checked={ackB} />
				<span>I have exported anything I want to keep.</span>
			</label>
			<div class="field">
				<label for="del-confirm">Type <span class="mono">{target}</span> to confirm</label>
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
					<p>
						This account owns a workspace that still has other members. Transfer ownership to
						another member — or remove them — before deleting the account.
					</p>
				</div>
				<ul class="cer-points danger">
					<li><Users size={16} /><span>Manage members and ownership from Settings → Account &amp; plan.</span></li>
				</ul>
			</div>
		{:else}
			<div class="cer-pane">
				<div class="cer-lede">
					<p>Confirm it’s really you. This is the point of no return for this device’s sessions.</p>
				</div>
				<div class="field">
					<label for="del-pw">Current password</label>
					<input
						id="del-pw"
						class="tin"
						type="password"
						bind:value={cur}
						placeholder="Enter current password"
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
							{twoFaMode === 'totp' ? 'Authenticator code' : 'Backup code'}
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
						{twoFaMode === 'totp' ? 'Use a backup code instead' : 'Use an authenticator code instead'}
					</button>
				{/if}
				{#if hasWebauthn}
					<Button variant="secondary" size="sm" disabled={busy || cur.length === 0} onclick={submitWithWebauthn}>
						<Fingerprint size={14} />Use security key or passkey
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
			title="Account scheduled for deletion"
			desc={`You’ve been signed out everywhere. Everything will be permanently erased on ${purgeDateLabel}. Until then you can cancel by logging back in. We’re sorry to see you go.`}
		/>
	{/if}

	{#snippet footer()}
		{#if step === 0}
			<Button variant="ghost" onclick={onClose}>Keep my account</Button>
			<Button variant="danger" onclick={() => (step = 1)}>
				Continue<ArrowRight size={15} />
			</Button>
		{:else if step === 1}
			<Button variant="ghost" onclick={() => (step = 0)}>
				<ArrowLeft size={15} />Back
			</Button>
			<Button variant="danger" disabled={!canContinue} onclick={() => (step = 2)}>
				Continue<ArrowRight size={15} />
			</Button>
		{:else if step === 2}
			{#if workspaceBlocked}
				<Button variant="primary" onclick={onClose}>Open settings</Button>
			{:else}
				<Button variant="ghost" disabled={busy} onclick={() => (step = 1)}>
					<ArrowLeft size={15} />Back
				</Button>
				<Button variant="danger" disabled={busy || !canSubmit} onclick={submit}>
					{#if busy}
						Verifying…
					{:else}
						<Trash2 size={15} />Delete account permanently
					{/if}
				</Button>
			{/if}
		{:else}
			<Button variant="primary" disabled={signingOut} onclick={signOutDeleted}>
				<LogOut size={15} />{signingOut ? 'Signing out…' : 'Sign out'}
			</Button>
		{/if}
	{/snippet}
</CeremonyShell>

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
