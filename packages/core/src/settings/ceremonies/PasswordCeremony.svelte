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
	} from '$core/api/auth';
	import {
		init2faWebauthn,
		verify2faBackupCode,
		verify2faTotp,
		verify2faWebauthn
	} from '$core/api/twofactor';
	import {
		ApiCallError,
		type PasswordChangeGrant,
		type TwoFactorMethod,
		type TwoFactorPending,
		type TwoFactorVerifyResponse
	} from '$core/api/types';
	import { getAssertion, isWebauthnCancelled, webauthnSupported } from '$core/auth/webauthn';
	import { strengthLabel, passwordReqs, scorePassword } from '$core/auth/password-policy';
	import { keystore } from '$core/keystore/keystore-client';
	import { auth } from '$core/stores/auth.svelte';
	import type { CeremonyKind } from '../data';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';

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
			? [
					m.settings_ceremony_password_step_verify(),
					m.settings_ceremony_password_step_twofa(),
					m.settings_ceremony_password_step_new(),
					m.settings_ceremony_password_step_rewrap(),
					m.settings_ceremony_password_step_done()
				]
			: [
					m.settings_ceremony_password_step_verify(),
					m.settings_ceremony_password_step_new(),
					m.settings_ceremony_password_step_rewrap(),
					m.settings_ceremony_password_step_done()
				]
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

	const RUN_LINES = $derived([
		m.settings_ceremony_password_line_derive(),
		m.settings_ceremony_password_line_reencrypt(),
		m.settings_ceremony_password_line_server(),
		m.settings_ceremony_password_line_finalize()
	]);

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
			verifyError = m.settings_ceremony_password_err_locked();
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
			verifyError = m.settings_ceremony_password_err_server_proof();
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
			verifyError = m.settings_ceremony_password_err_incorrect();
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
				verifyError = m.settings_ceremony_password_err_unexpected();
			}
		} catch (err) {
			console.warn('password change: verify failed', err);
			if (err instanceof ApiCallError && err.status === 401) {
				verifyError = m.settings_ceremony_password_err_incorrect();
			} else if (err instanceof ApiCallError && err.status === 429) {
				verifyError = m.settings_ceremony_password_err_rate_limited();
			} else {
				verifyError = m.settings_ceremony_password_err_verify_network();
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
				twoFaError = m.settings_ceremony_password_err_unexpected_restart();
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
					? m.settings_ceremony_password_err_twofa_failed()
					: m.common_something_went_wrong();
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
					? m.settings_ceremony_password_err_locked()
					: m.settings_ceremony_password_err_expired();
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
			runError = m.settings_ceremony_password_err_locked();
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
			runError = m.settings_ceremony_password_err_expired();
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
			runError = m.settings_ceremony_password_err_expired();
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
					runError = m.settings_ceremony_password_err_expired();
					runRetryable = false;
				} else if (err.status === 422) {
					runError = m.settings_ceremony_password_err_rejected();
					runRetryable = false;
				} else if (err.status === 429) {
					runError = m.settings_ceremony_password_err_rate_limited_then();
					runRetryable = true;
				} else {
					runError = m.settings_ceremony_password_err_update_server();
					runRetryable = true;
				}
			} else {
				void keystore.invalidatePersistedVault({ accountId });
				runError = m.settings_ceremony_password_err_dropped();
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
	eyebrow={m.settings_ceremony_password_eyebrow()}
	title={m.settings_ceremony_password_title()}
	{steps}
	step={stepIndex}
	onClose={close}
>
	{#if phase === 'verify'}
		<div class="cer-pane">
			<div class="cer-lede">
				<p>{m.settings_ceremony_password_verify_lede()}</p>
			</div>
			<div class="field">
				<label for="cur-pw">{m.settings_ceremony_password_current()}</label>
				<input
					id="cur-pw"
					class="tin"
					type="password"
					bind:value={cur}
					placeholder={m.settings_ceremony_password_current_placeholder()}
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
				<p>{m.settings_ceremony_password_twofa_lede()}</p>
			</div>
			{#if hasTotp || hasBackup}
				<div class="field">
					<label for="pwc-2fa-code">
						{twoFaMode === 'totp'
							? m.settings_ceremony_password_authenticator_code()
							: m.settings_ceremony_password_backup_code()}
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
					{twoFaMode === 'totp'
						? m.settings_ceremony_password_use_backup()
						: m.settings_ceremony_password_use_authenticator()}
				</button>
			{/if}
			{#if hasWebauthn}
				<Button variant="secondary" size="sm" disabled={twoFaBusy} onclick={submitTwoFaWebauthn}>
					<Fingerprint size={14} />{m.settings_ceremony_password_use_security_key()}
				</Button>
			{/if}
			{#if twoFaError}
				<span class="errtext"><CircleAlert size={13} /><span>{twoFaError}</span></span>
			{/if}
		</div>
	{:else if phase === 'newpw'}
		<div class="cer-pane">
			<div class="field">
				<label for="new-pw">{m.settings_ceremony_password_new()}</label>
				<input
					id="new-pw"
					class="tin"
					type="password"
					bind:value={pw}
					placeholder={m.settings_ceremony_password_new_placeholder()}
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
					<span class="pws-label">{strengthLabel(score)}</span>
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
						{m.settings_ceremony_password_req_differs()}
					</span>
				</div>
			{/if}
			<div class="field">
				<label for="new-pw2">{m.settings_ceremony_password_confirm()}</label>
				<input
					id="new-pw2"
					class="tin"
					type="password"
					bind:value={pw2}
					placeholder={m.settings_ceremony_password_confirm_placeholder()}
					autocomplete="new-password"
					onkeydown={(e) => {
						if (e.key === 'Enter' && pwReady) void changePassword();
					}}
				/>
			</div>
			{#if pw2.length > 0 && !match}
				<span class="errtext"><CircleAlert size={13} /><span>{m.settings_ceremony_password_mismatch()}</span></span>
			{/if}
			<div class="inline-warn">
				<KeyRound size={15} />
				<span>{m.settings_ceremony_password_rewrap_warning()}</span>
			</div>
		</div>
	{:else if phase === 'run'}
		<div class="cer-pane">
			<ProgressRun label={m.settings_ceremony_password_progress()} lines={RUN_LINES} progress={runProgress} />
			{#if runError}
				<span class="errtext"><CircleAlert size={13} /><span>{runError}</span></span>
			{/if}
		</div>
	{:else}
		<DoneScreen
			icon={Lock}
			title={m.settings_ceremony_password_done_title()}
			desc={m.settings_ceremony_password_done_desc()}
		/>
	{/if}

	{#snippet footer()}
		{#if phase === 'verify'}
			<Button variant="ghost" onclick={close}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={cur.length === 0 || verifying} onclick={() => void verifyCurrent()}>
				{#if verifying}
					{m.settings_ceremony_password_checking()}
				{:else}
					{m.common_continue()}<ArrowRight size={15} />
				{/if}
			</Button>
		{:else if phase === 'twofa'}
			<Button variant="ghost" disabled={twoFaBusy} onclick={restart}>
				{m.settings_ceremony_password_start_over()}
			</Button>
			<Button variant="primary" disabled={twoFaBusy || !twoFaCodeReady} onclick={submitTwoFaCode}>
				{#if twoFaBusy}
					{m.settings_ceremony_password_verifying()}
				{:else}
					{m.settings_ceremony_password_verify()}<ArrowRight size={15} />
				{/if}
			</Button>
		{:else if phase === 'newpw'}
			<Button variant="ghost" onclick={close}>{m.common_cancel()}</Button>
			<Button variant="primary" disabled={!pwReady} onclick={() => void changePassword()}>
				{m.settings_ceremony_password_submit()}<ArrowRight size={15} />
			</Button>
		{:else if phase === 'run'}
			{#if runError}
				<Button variant="ghost" onclick={restart}>{m.settings_ceremony_password_start_over()}</Button>
				{#if runRetryable}
					<Button variant="primary" onclick={() => void changePassword()}>
						{m.common_retry()}
					</Button>
				{/if}
			{/if}
		{:else if phase === 'done'}
			<Button variant="primary" onclick={finish}>{m.common_done()}</Button>
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
