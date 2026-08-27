<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Check from '@lucide/svelte/icons/check';
	import Minus from '@lucide/svelte/icons/minus';
	import CeremonyShell from '../CeremonyShell.svelte';
	import ProgressRun from '../ProgressRun.svelte';
	import DoneScreen from '../DoneScreen.svelte';
	import {
		passwordChangeComplete,
		passwordChangeCompleteOpaque,
		passwordChangeInit,
		passwordChangeOpaqueInit,
		passwordChangeOpaqueRegistrationInit,
		passwordChangeOpaqueVerify,
		passwordChangeVerify
	} from '$lib/api/auth';
	import {
		init2faWebauthn,
		verify2faBackupCode,
		verify2faTotp,
		verify2faWebauthn
	} from '$lib/api/twofactor';
	import {
		ApiCallError,
		type PasswordChangeGrant,
		type TwoFactorMethod,
		type TwoFactorPending,
		type TwoFactorVerifyResponse
	} from '$lib/api/types';
	import { getAssertion, isWebauthnCancelled, webauthnSupported } from '$lib/auth/webauthn';
	import { STRENGTH_LABELS, passwordReqs, scorePassword } from '$lib/auth/password-policy';
	import { keystore } from '$lib/keystore/keystore-client';
	import { auth } from '$lib/stores/auth.svelte';
	import type { CeremonyKind } from '../data';

	interface Props {
		onClose: () => void;
		onComplete: (k: CeremonyKind) => void;
	}

	let { onClose, onComplete }: Props = $props();

	type Phase = 'verify' | 'twofa' | 'newpw' | 'run' | 'done';

	let phase = $state<Phase>('verify');
	let authScheme = $state<'srp_v1' | 'opaque_v1'>('srp_v1');
	let modulus = $state('');
	let cur = $state('');
	let pw = $state('');
	let pw2 = $state('');

	let verifying = $state(false);
	let verifyError = $state('');

	interface PendingTwoFactor {
		pendingToken: string;
		methods: TwoFactorMethod[];
	}
	let pending2fa = $state<PendingTwoFactor | null>(null);
	let hadTwoFactor = $state(false);
	let twoFaMode = $state<'totp' | 'backup'>('totp');
	let twoFaCode = $state('');
	let twoFaBusy = $state(false);
	let twoFaError = $state('');

	let changeToken = $state<string | null>(null);
	let changeTokenExpiresAt = $state(0);

	let runProgress = $state(0);
	let runError = $state('');
	let runRetryable = $state(true);

	const steps = $derived(
		hadTwoFactor
			? ['Verify', 'Two-factor', 'New password', 'Re-wrap key', 'Done']
			: ['Verify', 'New password', 'Re-wrap key', 'Done']
	);
	const stepIndex = $derived.by(() => {
		const order: Phase[] = hadTwoFactor
			? ['verify', 'twofa', 'newpw', 'run', 'done']
			: ['verify', 'newpw', 'run', 'done'];
		const i = order.indexOf(phase);
		return i < 0 ? 0 : i;
	});

	const score = $derived(pw ? scorePassword(pw) : 0);
	const reqs = $derived(passwordReqs(pw));
	const allMet = $derived(reqs.every((r) => r.met));
	const match = $derived(pw2.length > 0 && pw === pw2);
	const differs = $derived(pw.length > 0 && pw !== cur);
	const pwReady = $derived(allMet && match && differs);

	const hasTotp = $derived(pending2fa?.methods.includes('totp') ?? false);
	const hasBackup = $derived(pending2fa?.methods.includes('backupCode') ?? false);
	const hasWebauthn = $derived(
		(pending2fa?.methods.includes('webauthn') ?? false) && webauthnSupported()
	);
	const twoFaCodeReady = $derived(
		twoFaMode === 'totp' ? /^\d{6}$/.test(twoFaCode) : twoFaCode.trim().length > 0
	);

	const RUN_LINES = [
		'Deriving new key from password',
		'Re-encrypting private key',
		'Updating the server',
		'Finalizing this device'
	];

	function close() {
		void keystore.abandonPasswordChange();
		onClose();
	}

	function acceptGrant(token: string, expiresInSeconds: number) {
		changeToken = token;
		changeTokenExpiresAt = Date.now() + expiresInSeconds * 1000 - 10_000;
	}

	function acceptVerifyResult(
		res: Partial<PasswordChangeGrant> & { twoFactor?: TwoFactorPending }
	): boolean {
		if (res.twoFactor) {
			pending2fa = {
				pendingToken: res.twoFactor.pendingToken,
				methods: res.twoFactor.methods
			};
			hadTwoFactor = true;
			twoFaMode = res.twoFactor.methods.includes('totp') ? 'totp' : 'backup';
			twoFaCode = '';
			twoFaError = '';
			phase = 'twofa';
			return true;
		}
		if (res.changeToken) {
			acceptGrant(res.changeToken, res.changeTokenExpiresInSeconds ?? 600);
			phase = 'newpw';
			return true;
		}
		return false;
	}

	async function verifyCurrentSrp(accountId: string): Promise<boolean> {
		const init = await passwordChangeInit(accountId);
		modulus = init.modulus;
		const proofs = await keystore.preparePasswordChangeProof({
			accountId,
			currentPassword: cur,
			modulus: init.modulus,
			salt: init.salt,
			serverPublicEphemeral: init.serverPublicEphemeral
		});
		if (!proofs.ok) {
			verifyError = 'Your mailbox is locked on this device. Sign in again, then retry.';
			return true;
		}
		const res = await passwordChangeVerify(
			{
				challengeId: init.challengeId,
				clientPublicEphemeral: proofs.clientPublicEphemeral,
				clientProof: proofs.clientProof
			},
			accountId
		);
		const check = await keystore.verifyPasswordChangeProof({ serverProof: res.serverProof });
		if (!check.ok) {
			verifyError = 'Could not verify the server. Please try again.';
			return true;
		}
		return acceptVerifyResult(res);
	}

	async function verifyCurrentOpaque(accountId: string): Promise<boolean> {
		const start = await keystore.opaqueStartAuth({ password: cur });
		const init = await passwordChangeOpaqueInit({ ke1: start.ke1 }, accountId);
		const finish = await keystore.opaqueFinishAuth({
			operationId: start.operationId,
			accountId,
			ke2: init.ke2
		});
		if (!finish.ok) {
			verifyError = 'That password is incorrect.';
			return true;
		}
		const res = await passwordChangeOpaqueVerify({ challengeId: init.challengeId, ke3: finish.ke3 }, accountId);
		return acceptVerifyResult(res);
	}

	async function verifyCurrent() {
		if (verifying || cur.length === 0) return;
		const accountId = auth.accountId;
		if (!accountId) return;
		verifying = true;
		verifyError = '';
		try {
			const status = await keystore.status();
			authScheme = status.accounts.find((a) => a.accountId === accountId)?.authScheme ?? 'srp_v1';
			const handled =
				authScheme === 'opaque_v1'
					? await verifyCurrentOpaque(accountId)
					: await verifyCurrentSrp(accountId);
			if (!handled) {
				verifyError = 'Unexpected server response. Please try again.';
			}
		} catch (err) {
			console.warn('password change: verify failed', err);
			if (err instanceof ApiCallError && err.status === 401) {
				verifyError = 'That password is incorrect.';
			} else if (err instanceof ApiCallError && err.status === 429) {
				verifyError = 'Too many attempts. Wait a few minutes and try again.';
			} else {
				verifyError = 'Could not verify — check your connection and retry.';
			}
		} finally {
			verifying = false;
		}
	}

	async function runTwoFactor(fn: () => Promise<TwoFactorVerifyResponse>) {
		if (twoFaBusy || !pending2fa) return;
		twoFaBusy = true;
		twoFaError = '';
		try {
			const res = await fn();
			if (res.scope !== 'password_change' || !res.changeToken) {
				twoFaError = 'Unexpected server response. Start over and try again.';
				return;
			}
			acceptGrant(res.changeToken, res.changeTokenExpiresInSeconds ?? 600);
			pending2fa = null;
			phase = 'newpw';
		} catch (err) {
			if (isWebauthnCancelled(err)) return;
			console.warn('password change: two-factor failed', err);
			twoFaCode = '';
			twoFaError =
				err instanceof ApiCallError && err.status === 401
					? 'That didn’t verify. Try again.'
					: 'Something went wrong. Try again.';
		} finally {
			twoFaBusy = false;
		}
	}

	function submitTwoFaCode() {
		if (twoFaBusy || !twoFaCodeReady || !pending2fa) return;
		const token = pending2fa.pendingToken;
		const code = twoFaCode.trim();
		void runTwoFactor(() =>
			twoFaMode === 'totp'
				? verify2faTotp({ pendingToken: token, code })
				: verify2faBackupCode({ pendingToken: token, code })
		);
	}

	function submitTwoFaWebauthn() {
		if (twoFaBusy || !pending2fa) return;
		const token = pending2fa.pendingToken;
		void runTwoFactor(async () => {
			const options = await init2faWebauthn({ pendingToken: token });
			const credential = await getAssertion(options);
			return verify2faWebauthn({ pendingToken: token, credential });
		});
	}

	function restart() {
		void keystore.abandonPasswordChange();
		pending2fa = null;
		hadTwoFactor = false;
		changeToken = null;
		cur = '';
		twoFaCode = '';
		twoFaError = '';
		verifyError = '';
		runError = '';
		runProgress = 0;
		runRetryable = true;
		phase = 'verify';
	}

	async function changePasswordSrp(accountId: string): Promise<boolean> {
		const prepared = await keystore.preparePasswordChangeCredentials({
			accountId,
			newPassword: pw,
			modulus
		});
		if (!prepared.ok) {
			runRetryable = false;
			runError =
				prepared.code === 'locked'
					? 'Your mailbox is locked on this device. Sign in again, then retry.'
					: 'This change request expired. Start over to verify again.';
			return false;
		}
		runProgress = 2;
		await passwordChangeComplete(
			{
				changeToken: changeToken as string,
				srpSalt: prepared.srpSalt,
				srpVerifier: prepared.srpVerifier,
				keySalt: prepared.keySalt,
				encryptedPrivateKey: prepared.encryptedPrivateKey,
				kdfParamsVersion: 1,
				srpParamsVersion: 1
			},
			accountId
		);
		runProgress = 3;
		const committed = await keystore.commitPasswordChange({ accountId });
		if (!committed.ok) {
			console.warn('password change: local commit failed', committed);
			void keystore.invalidatePersistedVault({ accountId });
		}
		return true;
	}

	async function changePasswordOpaque(accountId: string): Promise<boolean> {
		const start = await keystore.opaquePasswordChangeStart({ accountId, newPassword: pw });
		if (!start.ok) {
			runRetryable = false;
			runError = 'Your mailbox is locked on this device. Sign in again, then retry.';
			return false;
		}
		runProgress = 2;
		const init = await passwordChangeOpaqueRegistrationInit(
			{ registrationRequest: start.registrationRequest },
			accountId
		);
		const finish = await keystore.opaquePasswordChangeFinish({
			accountId,
			operationId: start.operationId,
			registrationResponse: init.registrationResponse
		});
		if (!finish.ok) {
			runRetryable = false;
			runError = 'This change request expired. Start over to verify again.';
			return false;
		}
		await passwordChangeCompleteOpaque(
			{
				changeToken: changeToken as string,
				opaqueRecord: finish.opaqueRecord,
				wrappedMasterKey: finish.wrappedMasterKey,
				masterKeyId: finish.masterKeyId,
				opaqueParamsVersion: finish.opaqueParamsVersion
			},
			accountId
		);
		runProgress = 3;
		const committed = await keystore.opaquePasswordChangeCommit({
			accountId,
			operationId: start.operationId
		});
		if (!committed.ok) {
			console.warn('password change: local commit failed', committed);
			void keystore.invalidatePersistedVault({ accountId });
		}
		return true;
	}

	async function changePassword() {
		if (!pwReady || !changeToken) return;
		const accountId = auth.accountId;
		if (!accountId) return;
		phase = 'run';
		runError = '';
		runRetryable = true;
		runProgress = 0;
		if (Date.now() > changeTokenExpiresAt) {
			runError = 'This change request expired. Start over to verify again.';
			runRetryable = false;
			return;
		}
		try {
			const ok =
				authScheme === 'opaque_v1'
					? await changePasswordOpaque(accountId)
					: await changePasswordSrp(accountId);
			if (!ok) return;
			runProgress = 4;
			cur = '';
			pw = '';
			pw2 = '';
			changeToken = null;
			phase = 'done';
		} catch (err) {
			console.warn('password change: complete failed', err);
			if (err instanceof ApiCallError) {
				if (err.status === 401) {
					runError = 'This change request expired. Start over to verify again.';
					runRetryable = false;
				} else if (err.status === 422) {
					runError = 'The re-encrypted key was rejected. Start over and try again.';
					runRetryable = false;
				} else if (err.status === 429) {
					runError = 'Too many attempts. Wait a few minutes, then try again.';
					runRetryable = true;
				} else {
					runError = 'Could not update the server. Check your connection and try again.';
					runRetryable = true;
				}
			} else {
				void keystore.invalidatePersistedVault({ accountId });
				runError =
					'The connection dropped before we could confirm. If the new password doesn’t work next time, sign in with your old one.';
				runRetryable = true;
			}
		}
	}

	function finish() {
		onComplete('password');
		onClose();
	}
</script>

<CeremonyShell
	icon={Lock}
	eyebrow="Security · ceremony"
	title="Change password"
	{steps}
	step={stepIndex}
	onClose={close}
>
	{#if phase === 'verify'}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					Your password unlocks your private key. Changing it re-encrypts that key — so we'll
					confirm it's really you first.
				</p>
			</div>
			<div class="field">
				<label for="cur-pw">Current password</label>
				<input
					id="cur-pw"
					class="tin"
					type="password"
					bind:value={cur}
					placeholder="Enter current password"
					autocomplete="current-password"
					disabled={verifying}
					onkeydown={(e) => {
						if (e.key === 'Enter') void verifyCurrent();
					}}
				/>
			</div>
			{#if verifyError}
				<span class="errtext"><CircleAlert size={13} /><span>{verifyError}</span></span>
			{/if}
		</div>
	{:else if phase === 'twofa'}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>
					Password confirmed. This account also asks for a second factor before the key is
					re-wrapped.
				</p>
			</div>
			{#if hasTotp || hasBackup}
				<div class="field">
					<label for="pwc-2fa-code">
						{twoFaMode === 'totp' ? 'Authenticator code' : 'Backup code'}
					</label>
					<input
						id="pwc-2fa-code"
						class="tin mono otp"
						maxlength={twoFaMode === 'totp' ? 6 : 12}
						inputmode={twoFaMode === 'totp' ? 'numeric' : 'text'}
						autocomplete={twoFaMode === 'totp' ? 'one-time-code' : 'off'}
						spellcheck={false}
						disabled={twoFaBusy}
						value={twoFaCode}
						oninput={(e) => {
							const v = (e.currentTarget as HTMLInputElement).value;
							twoFaCode = twoFaMode === 'totp' ? v.replace(/\D/g, '') : v;
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter') submitTwoFaCode();
						}}
						placeholder={twoFaMode === 'totp' ? '000000' : 'XXXX-XXXX'}
					/>
				</div>
			{/if}
			{#if hasTotp && hasBackup}
				<button
					type="button"
					class="linklike"
					disabled={twoFaBusy}
					onclick={() => {
						twoFaMode = twoFaMode === 'totp' ? 'backup' : 'totp';
						twoFaCode = '';
						twoFaError = '';
					}}
				>
					{twoFaMode === 'totp' ? 'Use a backup code instead' : 'Use an authenticator code instead'}
				</button>
			{/if}
			{#if hasWebauthn}
				<button
					type="button"
					class="btn btn-secondary btn-sm"
					disabled={twoFaBusy}
					onclick={submitTwoFaWebauthn}
				>
					<Fingerprint size={14} />Use security key or passkey
				</button>
			{/if}
			{#if twoFaError}
				<span class="errtext"><CircleAlert size={13} /><span>{twoFaError}</span></span>
			{/if}
		</div>
	{:else if phase === 'newpw'}
		<div class="cer-pane">
			<div class="field">
				<label for="new-pw">New password</label>
				<input
					id="new-pw"
					class="tin"
					type="password"
					bind:value={pw}
					placeholder="At least 8 characters"
					autocomplete="new-password"
				/>
			</div>
			{#if pw.length > 0}
				<div class="pw-strength">
					<div class="pws-bars">
						{#each [0, 1, 2, 3] as i (i)}
							<span class={i < score ? 'on s' + score : ''}></span>
						{/each}
					</div>
					<span class="pws-label">{STRENGTH_LABELS[score]}</span>
				</div>
				<div class="pwc-reqs">
					{#each reqs as r (r.k)}
						<span class="pwc-req" class:met={r.met}>
							{#if r.met}<Check size={11} strokeWidth={2.5} />{:else}<Minus
									size={11}
									strokeWidth={2.5}
								/>{/if}
							{r.label}
						</span>
					{/each}
					<span class="pwc-req" class:met={differs}>
						{#if differs}<Check size={11} strokeWidth={2.5} />{:else}<Minus
								size={11}
								strokeWidth={2.5}
							/>{/if}
						Different from your current password
					</span>
				</div>
			{/if}
			<div class="field">
				<label for="new-pw2">Confirm new password</label>
				<input
					id="new-pw2"
					class="tin"
					type="password"
					bind:value={pw2}
					placeholder="Repeat it"
					autocomplete="new-password"
					onkeydown={(e) => {
						if (e.key === 'Enter' && pwReady) void changePassword();
					}}
				/>
			</div>
			{#if pw2.length > 0 && !match}
				<span class="errtext"><CircleAlert size={13} /><span>Passwords don't match yet.</span></span>
			{/if}
			<div class="inline-warn">
				<KeyRound size={15} />
				<span>
					This re-wraps your encryption key. Other devices will be signed out and will ask for the
					new password.
				</span>
			</div>
		</div>
	{:else if phase === 'run'}
		<div class="cer-pane">
			<ProgressRun label="Re-wrapping your key material…" lines={RUN_LINES} progress={runProgress} />
			{#if runError}
				<span class="errtext"><CircleAlert size={13} /><span>{runError}</span></span>
			{/if}
		</div>
	{:else}
		<DoneScreen
			icon={Lock}
			title="Password changed"
			desc="Your key has been re-wrapped with the new password. Other devices have been signed out — within the hour they'll ask for the new password."
		/>
	{/if}

	{#snippet footer()}
		{#if phase === 'verify'}
			<button type="button" class="btn btn-ghost" onclick={close}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary"
				disabled={cur.length === 0 || verifying}
				onclick={() => void verifyCurrent()}
			>
				{#if verifying}
					Checking…
				{:else}
					Continue<ArrowRight size={15} />
				{/if}
			</button>
		{:else if phase === 'twofa'}
			<button type="button" class="btn btn-ghost" disabled={twoFaBusy} onclick={restart}>
				Start over
			</button>
			<button
				type="button"
				class="btn btn-primary"
				disabled={twoFaBusy || !twoFaCodeReady}
				onclick={submitTwoFaCode}
			>
				{#if twoFaBusy}
					Verifying…
				{:else}
					Verify<ArrowRight size={15} />
				{/if}
			</button>
		{:else if phase === 'newpw'}
			<button type="button" class="btn btn-ghost" onclick={close}>Cancel</button>
			<button
				type="button"
				class="btn btn-primary"
				disabled={!pwReady}
				onclick={() => void changePassword()}
			>
				Change password<ArrowRight size={15} />
			</button>
		{:else if phase === 'run'}
			{#if runError}
				<button type="button" class="btn btn-ghost" onclick={restart}>Start over</button>
				{#if runRetryable}
					<button type="button" class="btn btn-primary" onclick={() => void changePassword()}>
						Try again
					</button>
				{/if}
			{/if}
		{:else if phase === 'done'}
			<button type="button" class="btn btn-primary" onclick={finish}>Done</button>
		{/if}
	{/snippet}
</CeremonyShell>

<style>
	.pwc-reqs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		margin-top: -4px;
	}
	.pwc-req {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--ink-500);
	}
	.pwc-req.met {
		color: var(--pine-700);
	}
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
