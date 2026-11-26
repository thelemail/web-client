<script lang="ts">
	import { platform } from '$platform';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { passwordReqs } from '$core/auth/password-policy';
	import { untrack } from 'svelte';
	import TextField from '$core/auth/form/TextField.svelte';
	import PasswordField from '$core/auth/PasswordField.svelte';
	import PasswordChecks from '$core/auth/form/PasswordChecks.svelte';
	import WorkSteps from '$core/auth/form/WorkSteps.svelte';
	import {
		completeRecoveryReset,
		discardRecovery,
		RecoveryPhraseError,
		RecoveryResetExpiredError,
		submitRecoveryTwoFactorBackupCode,
		submitRecoveryTwoFactorTotp,
		submitRecoveryTwoFactorWebauthn,
		verifyRecoveryPhrase,
		type PendingTwoFactorRecovery,
		type VerifyRecoveryPhraseResult
	} from '$core/auth/perform-recovery';
	import { TwoFactorExpiredError, TwoFactorRejectedError } from '$core/auth/perform-login';
	import TwoFactorChallenge from '$core/auth/TwoFactorChallenge.svelte';
	import { webauthnFailure, webauthnFailureMessage } from '$core/auth/webauthn';
	import { validateMnemonic } from '@scure/bip39';
	import { wordlist } from '@scure/bip39/wordlists/english.js';
	import Icon from '$core/components/Icon.svelte';
	import { faCheck, faCircleCheck, faCircleExclamation } from '@fortawesome/pro-regular-svg-icons';
	import Status from '$core/auth/form/Status.svelte';
	import BusyLabel from '$core/auth/form/BusyLabel.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	const workLines = $derived([
		m.auth_recover_work_open(),
		m.auth_recover_work_derive(),
		m.auth_recover_work_rewrap(),
		m.auth_recover_work_retire()
	]);

	type Step = 'phrase' | 'nophrase' | 'twofa' | 'password' | 'working' | 'done';
	let step = $state<Step>('phrase');

	let pendingTwoFactor = $state.raw<PendingTwoFactorRecovery | null>(null);
	let twoFaBusy = $state(false);
	let twoFaError = $state<string | null>(null);
	let twoFaKeyNotice = $state<string | null>(null);
	let twoFaFailures = $state(0);

	let email = $state(page.url.searchParams.get('email') ?? '');
	const emailValid = $derived(/\S+@\S+\.\S+/.test(email));

	let words = $state<string[]>(Array(12).fill(''));
	let phraseStatus = $state<'idle' | 'checking' | 'bad'>('idle');
	let phraseError = $state('');
	let inputs: HTMLInputElement[] = $state([]);
	const allFilled = $derived(words.every((w) => w.trim().length > 0));
	const phrase = $derived(words.map((w) => w.trim().toLowerCase()).join(' '));

	let resetToken = $state('');
	let resetTokenExpiresAt = $state(0);
	let opaqueOperationId = $state<string | undefined>(undefined);
	let recoveredAccountId = $state<string | undefined>(undefined);
	let heldOperation: string | undefined;

	function releaseRecovery() {
		const held = heldOperation;
		heldOperation = undefined;
		void discardRecovery(held);
	}

	let pw = $state('');
	let confirm = $state('');
	let workIdx = $state(0);
	let workError = $state('');

	function exitToLogin() {
		void goto('/login');
	}

	function setWord(i: number, v: string) {
		phraseStatus = 'idle';
		const clean = v.toLowerCase().replace(/[^a-z]/g, '');
		words = words.map((w, k) => (k === i ? clean : w));
	}

	function onPhrasePaste(i: number, e: ClipboardEvent) {
		const tokens = (e.clipboardData?.getData('text') ?? '').toLowerCase().match(/[a-z]+/g) ?? [];
		if (tokens.length < 2) return;
		e.preventDefault();
		phraseStatus = 'idle';
		const start = tokens.length === 12 ? 0 : i;
		words = words.map((w, k) => (k >= start && k - start < tokens.length ? tokens[k - start] : w));
		const last = Math.min(11, start + tokens.length - 1);
		inputs[last]?.focus();
	}

	function onPhraseKey(i: number, e: KeyboardEvent) {
		if (e.key === ' ' || (e.key === 'Enter' && i < 11)) {
			e.preventDefault();
			inputs[i + 1]?.focus();
		} else if (e.key === 'Enter' && i === 11 && allFilled) {
			void verifyPhrase();
		} else if (e.key === 'Backspace' && words[i] === '' && i > 0) {
			e.preventDefault();
			inputs[i - 1]?.focus();
		}
	}

	function badWord(w: string): boolean {
		const t = w.trim().toLowerCase();
		return t.length > 0 && !wordlist.includes(t);
	}

	async function verifyPhrase() {
		if (!emailValid || !allFilled || phraseStatus === 'checking') return;
		if (!validateMnemonic(phrase, wordlist)) {
			phraseStatus = 'bad';
			phraseError = m.auth_s_recover_phrase_invalid();
			return;
		}
		phraseStatus = 'checking';
		phraseError = '';
		if (heldOperation) releaseRecovery();
		try {
			const outcome = await verifyRecoveryPhrase({ email, phrase });
			if (step !== 'phrase') {
				heldOperation =
					outcome.status === 'twoFactorRequired'
						? outcome.pending.opaqueOperationId
						: outcome.result.opaqueOperationId;
				releaseRecovery();
				phraseStatus = 'idle';
				return;
			}
			phraseStatus = 'idle';
			if (outcome.status === 'twoFactorRequired') {
				heldOperation = outcome.pending.opaqueOperationId;
				pendingTwoFactor = outcome.pending;
				twoFaError = null;
				twoFaKeyNotice = null;
				twoFaFailures = 0;
				step = 'twofa';
				return;
			}
			applyRecoveryResult(outcome.result);
		} catch (err) {
			if (step !== 'phrase') {
				phraseStatus = 'idle';
				return;
			}
			phraseStatus = 'bad';
			phraseError =
				err instanceof RecoveryPhraseError
					? m.auth_recover_phrase_wrong()
					: m.auth_recover_phrase_server_error();
		}
	}

	function applyRecoveryResult(res: VerifyRecoveryPhraseResult) {
		resetToken = res.resetToken;
		resetTokenExpiresAt = res.resetTokenExpiresAt;
		opaqueOperationId = res.opaqueOperationId;
		heldOperation = res.opaqueOperationId;
		recoveredAccountId = res.accountId;
		pendingTwoFactor = null;
		step = 'password';
	}

	function resetToPhraseStep(message: string) {
		releaseRecovery();
		pendingTwoFactor = null;
		twoFaBusy = false;
		twoFaError = null;
		twoFaKeyNotice = null;
		twoFaFailures = 0;
		phraseStatus = message ? 'bad' : 'idle';
		phraseError = message;
		step = 'phrase';
	}

	async function runRecoveryTwoFactor(
		fn: (pending: PendingTwoFactorRecovery) => Promise<VerifyRecoveryPhraseResult>
	) {
		const pending = pendingTwoFactor;
		if (!pending || twoFaBusy) return;
		if (Date.now() > pending.expiresAt) {
			resetToPhraseStep(m.auth_recover_2fa_expired());
			return;
		}
		twoFaBusy = true;
		twoFaError = null;
		twoFaKeyNotice = null;
		try {
			const res = await fn(pending);
			twoFaBusy = false;
			applyRecoveryResult(res);
		} catch (err) {
			if (err instanceof TwoFactorRejectedError) {
				twoFaFailures += 1;
				if (twoFaFailures >= 5 || Date.now() > pending.expiresAt) {
					resetToPhraseStep(m.auth_recover_2fa_expired());
					return;
				}
				twoFaError = m.auth_login_2fa_rejected();
				twoFaBusy = false;
				return;
			}
			if (err instanceof TwoFactorExpiredError) {
				resetToPhraseStep(m.auth_recover_2fa_expired());
				return;
			}
			const failure = webauthnFailure(err);
			if (failure) {
				if (failure !== 'aborted') twoFaKeyNotice = webauthnFailureMessage(failure);
				twoFaBusy = false;
				return;
			}
			console.error('recovery two-factor failed', err);
			twoFaError = m.auth_login_2fa_failed();
			twoFaBusy = false;
		}
	}

	const emailFirst = untrack(() => !emailValid);

	$effect(() => {
		if (step === 'phrase') untrack(() => emailValid && inputs[0]?.focus());
	});

	$effect(() => {
		const pending = pendingTwoFactor;
		if (!pending) return;
		const expire = () => {
			if (twoFaBusy) expiry = setTimeout(expire, 1000);
			else resetToPhraseStep(m.auth_recover_2fa_expired());
		};
		let expiry = setTimeout(expire, Math.max(0, pending.expiresAt - Date.now()));
		return () => clearTimeout(expiry);
	});

	$effect(() => {
		const onPageHide = () => {
			if (step === 'twofa') resetToPhraseStep('');
			else if (step === 'password') startOver();
		};
		window.addEventListener('pagehide', onPageHide);
		return () => {
			window.removeEventListener('pagehide', onPageHide);
			if (heldOperation && step !== 'working') releaseRecovery();
		};
	});

	const allMet = $derived(passwordReqs(pw).every((r) => r.met));
	const matches = $derived(confirm.length > 0 && confirm === pw);
	const mismatch = $derived(confirm.length > 0 && confirm !== pw);
	const confirmBad = $derived(mismatch && !pw.startsWith(confirm));
	const passwordReady = $derived(allMet && matches);

	function startOver() {
		releaseRecovery();
		words = Array(12).fill('');
		resetToken = '';
		resetTokenExpiresAt = 0;
		opaqueOperationId = undefined;
		recoveredAccountId = undefined;
		pw = '';
		confirm = '';
		workError = '';
		workIdx = 0;
		phraseStatus = 'idle';
		phraseError = '';
		step = 'phrase';
	}

	function submitPhrase(e: SubmitEvent) {
		e.preventDefault();
		void verifyPhrase();
	}

	function submitPassword(e: SubmitEvent) {
		e.preventDefault();
		startRekey();
	}

	function startRekey() {
		if (!passwordReady || step === 'working') return;
		workIdx = 1;
		workError = '';
		step = 'working';
		void runReset();
	}

	async function runReset() {
		try {
			await completeRecoveryReset({
				accountId: recoveredAccountId,
				resetToken,
				newPassword: pw,
				opaqueOperationId,
				onStage: (stage) => {
					if (stage === 'derive') workIdx = 1;
					else if (stage === 'rewrap') workIdx = 2;
					else if (stage === 'submit') workIdx = 3;
				}
			});
			heldOperation = undefined;
			workIdx = workLines.length;
			pw = '';
			confirm = '';
			resetToken = '';
			setTimeout(() => (step = 'done'), 500);
		} catch (err) {
			platform.reportError?.('recover', err);
			workError =
				err instanceof RecoveryResetExpiredError
					? m.auth_recover_reset_expired()
					: m.auth_recover_reset_failed();
		}
	}

</script>

{#snippet signInLink(t: string)}<a href="/login">{t}</a>{/snippet}
{#snippet addr(t: string)}<span class="mono">{t}</span>{/snippet}

<svelte:head>
	<title>{m.auth_recover_page_title()}</title>
</svelte:head>

{#if step === 'twofa'}
	{#if pendingTwoFactor}
		<TwoFactorChallenge
			{email}
			methods={pendingTwoFactor.methods}
			busy={twoFaBusy}
			error={twoFaError}
			keyNotice={twoFaKeyNotice}
			backLabel={m.common_back()}
			onTotp={(code) => runRecoveryTwoFactor((p) => submitRecoveryTwoFactorTotp(p, code))}
			onBackupCode={(code) => runRecoveryTwoFactor((p) => submitRecoveryTwoFactorBackupCode(p, code))}
			onWebauthn={() => runRecoveryTwoFactor((p) => submitRecoveryTwoFactorWebauthn(p))}
			onBack={() => resetToPhraseStep('')}
		>
			{#snippet lede()}{m.auth_recover_2fa_lede()}{/snippet}
		</TwoFactorChallenge>
	{/if}
{:else if step === 'phrase'}
	<form class="card-surface" novalidate onsubmit={submitPhrase}>
		<div class="card-head">
			<h1>{m.auth_recover_title()}</h1>
			<p>{m.auth_recover_sub()}</p>
		</div>
		<div class="form">
			<TextField
				id="rec-email"
				bind:value={email}
				type="email"
				label={m.common_email_address()}
				placeholder="you@yourdomain.com"
				mono
				autocomplete="username"
				disabled={phraseStatus === 'checking'}
				focus={emailFirst}
				normalize={(raw) => raw.trim()}
			/>
			<div class="field">
				<div class="lab"><span class="lbl" id="rec-phrase-label">{m.auth_recover_phrase_label()}</span></div>
				<div class="af-words" role="group" aria-labelledby="rec-phrase-label">
					{#each words as w, i (i)}
						{@const wrong = phraseStatus === 'bad' && badWord(w)}
						<label class="af-word" class:bad={wrong}>
							<span class="n">{i + 1}</span>
							<input
								value={w}
								bind:this={inputs[i]}
								spellcheck="false"
								autocomplete="off"
								autocapitalize="none"
								disabled={phraseStatus === 'checking'}
								aria-label={m.auth_s_word_label({ n: i + 1, total: 12 })}
								oninput={(e) => setWord(i, e.currentTarget.value)}
								onpaste={(e) => onPhrasePaste(i, e)}
								onkeydown={(e) => onPhraseKey(i, e)}
								aria-invalid={wrong || undefined}
								aria-describedby="recover-phrase-err"
							/>
						</label>
					{/each}
				</div>
				<Status id="recover-phrase-err" tone={phraseStatus === 'bad' ? 'bad' : 'hint'}>
					{phraseStatus === 'bad' ? phraseError : m.auth_recover_phrase_tip()}
				</Status>
			</div>
		</div>
		<Button type="submit" variant="primary" size="lg" block disabled={!emailValid || !allFilled || phraseStatus === 'checking'}>
			<BusyLabel
				busy={phraseStatus === 'checking'}
				label={m.auth_recover_phrase_unlock()}
				pending={m.auth_recover_phrase_checking()}
			/>
		</Button>
		<p class="af-row split">
			<button type="button" class="af-link muted" disabled={phraseStatus === 'checking'} onclick={() => (step = 'nophrase')}>
				{m.auth_recover_no_phrase()}
			</button>
			<span><Rich text={m.auth_recover_remembered()} tags={{ link: signInLink }} /></span>
		</p>
	</form>
{:else if step === 'nophrase'}
	<div class="card-surface">
		<div class="card-head">
			<h1>{m.auth_recover_nophrase_title()}</h1>
			<p>{m.auth_s_recover_nophrase()}</p>
		</div>
		<div class="af-options">
			<div class="af-option" role="presentation"><span class="tx"><b>{m.auth_recover_way_device_title()}</b><span>{m.auth_recover_way_device_body()}</span></span></div>
			<div class="af-option" role="presentation"><span class="tx"><b>{m.auth_recover_way_retry_title()}</b><span>{m.auth_recover_way_retry_body()}</span></span></div>
			<div class="af-option" role="presentation"><span class="tx"><b>{m.auth_recover_way_reset_title()}</b><span>{m.auth_recover_way_reset_body()}</span></span></div>
		</div>
		<Button variant="primary" size="lg" block onclick={() => (step = 'phrase')}>{m.auth_recover_look_for_phrase()}</Button>
		<p class="af-row"><button type="button" class="af-link muted" onclick={exitToLogin}>{m.auth_2fa_back_to_sign_in()}</button></p>
	</div>
{:else if step === 'password'}
	<form class="card-surface" novalidate onsubmit={submitPassword}>
		<input class="af-hidden-user" type="email" value={email} autocomplete="username" readonly tabindex="-1" aria-hidden="true" />
		<div class="card-head">
			<h1>{m.auth_recover_password_title()}</h1>
			<p><Rich text={m.auth_recover_password_sub({ email })} tags={{ addr }} /></p>
		</div>
		<div class="form">
			<div class="field">
				<PasswordField id="rec-password" label={m.auth_recover_new_password_label()} bind:value={pw} autocomplete="new-password" focus />
				<PasswordChecks {pw} />
			</div>
			<div class="field">
				<PasswordField
					id="rec-confirm"
					label={m.auth_recover_confirm_label()}
					bind:value={confirm}
					autocomplete="new-password"
					invalid={confirmBad}
					describedby="recover-confirm-msg"
				/>
				<Status id="recover-confirm-msg" tone={confirmBad ? 'bad' : matches ? 'ok' : 'hint'}>
					{confirmBad ? m.auth_register_passwords_mismatch() : matches ? m.auth_register_passwords_match() : m.auth_s_confirm_hint()}
				</Status>
			</div>
		</div>
		<p class="af-note">{m.auth_s_recover_rewrap_note()}</p>
		<Button type="submit" variant="primary" size="lg" block disabled={!passwordReady}>{m.auth_recover_reset_password()}</Button>
		<p class="af-row"><button type="button" class="af-link muted" onclick={() => (step = 'phrase')}>{m.common_back()}</button></p>
	</form>
{:else if step === 'working'}
	<div class="card-surface" aria-live="polite">
		<div class="card-head">
			<h1>{m.auth_recover_working_title()}</h1>
			<p>{m.auth_s_recover_working_note()}</p>
		</div>
		<WorkSteps lines={workLines} at={workIdx} failed={!!workError} />
		{#if workError}
			<p class="af-error" role="alert"><Icon icon={faCircleExclamation} size={16} /><span>{workError}</span></p>
			<Button variant="primary" size="lg" block onclick={startOver}>{m.auth_recover_start_over()}</Button>
			<p class="af-row"><button type="button" class="af-link muted" onclick={exitToLogin}>{m.auth_2fa_back_to_sign_in()}</button></p>
		{/if}
	</div>
{:else}
	<div class="card-surface">
		<div class="af-done">
			<span class="af-mark"><Icon icon={faCheck} size={28} /></span>
			<div class="card-head">
				<h1>{m.auth_recover_done_title()}</h1>
				<p>{m.auth_s_recover_done()}</p>
			</div>
		</div>
		<p class="af-note ok"><Icon icon={faCircleCheck} size={15} /><span>{m.auth_recover_done_signed_out()}</span></p>
		<p class="af-note ok"><Icon icon={faCircleCheck} size={15} /><span>{m.auth_recover_done_phrase_retired()}</span></p>
		<Button variant="primary" size="lg" block onclick={exitToLogin}>{m.auth_recover_done_sign_in()}</Button>
	</div>
{/if}
