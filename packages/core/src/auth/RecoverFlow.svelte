<script lang="ts">
	import { platform } from '$platform';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { passwordReqs } from '$core/auth/password-policy';
	import Blank from '$core/auth/sentence/Blank.svelte';
	import Clause from '$core/auth/sentence/Clause.svelte';
	import Done from '$core/auth/sentence/Done.svelte';
	import Trail from '$core/auth/sentence/Trail.svelte';
	import PasswordChecks from '$core/auth/sentence/PasswordChecks.svelte';
	import WorkSteps from '$core/auth/sentence/WorkSteps.svelte';
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
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Status from '$core/auth/sentence/Status.svelte';
	import BusyLabel from '$core/auth/sentence/BusyLabel.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	const recLabelsBase = $derived([
		m.auth_recover_step_account(),
		m.auth_recover_step_phrase(),
		m.auth_step_password()
	]);
	const recLabels2fa = $derived([
		m.auth_recover_step_account(),
		m.auth_recover_step_phrase(),
		m.auth_recover_step_2fa(),
		m.auth_step_password()
	]);
	const workLines = $derived([
		m.auth_recover_work_open(),
		m.auth_recover_work_derive(),
		m.auth_recover_work_rewrap(),
		m.auth_recover_work_retire()
	]);

	type Step =
		| 'account'
		| 'phrase'
		| 'nophrase'
		| 'twofa'
		| 'password'
		| 'working'
		| 'done';
	let step = $state<Step>('account');

	let pendingTwoFactor = $state.raw<PendingTwoFactorRecovery | null>(null);
	let twoFaBusy = $state(false);
	let twoFaError = $state<string | null>(null);
	let twoFaKeyNotice = $state<string | null>(null);
	let twoFaFailures = $state(0);
	let hadTwoFa = $state(false);
	const recLabels = $derived(hadTwoFa ? recLabels2fa : recLabelsBase);

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
	let pwPart = $state<'new' | 'again'>('new');
	let workIdx = $state(0);
	let workError = $state('');

	function exitToLogin() {
		void goto('/login');
	}

	function continueAccount() {
		if (!emailValid) return;
		step = 'phrase';
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
		if (!allFilled || phraseStatus === 'checking') return;
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
				hadTwoFa = true;
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

	$effect(() => {
		if (step === 'phrase') inputs[0]?.focus();
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
		pwPart = 'new';
		workError = '';
		workIdx = 0;
		phraseStatus = 'idle';
		phraseError = '';
		step = 'phrase';
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

	const trailAt = $derived(
		step === 'account' ? 0 : step === 'phrase' || step === 'nophrase' ? 1 : step === 'twofa' ? 2 : recLabels.length - 1
	);
</script>

{#snippet signInLink(t: string)}<a href="/login">{t}</a>{/snippet}
{#snippet emailBlank(_: string)}<Blank
		id="rec-email"
		bind:value={email}
		label={m.common_email_address()}
		placeholder="you@yourdomain.com"
		size={36}
		mono
		autocomplete="username"
		focus
		normalize={(raw) => raw.trim()}
		onenter={continueAccount}
	/>{/snippet}
{#snippet emailDone(_: string)}<Done
		text={email}
		mono
		disabled={phraseStatus === 'checking'}
		onedit={step === 'phrase' ? () => (step = 'account') : undefined}
	/>{/snippet}
{#snippet passwordBlank(_: string)}<Blank
		id="rec-password"
		bind:value={pw}
		label={m.auth_recover_new_password_label()}
		placeholder={m.auth_s_new_password_placeholder()}
		size={14}
		mono
		secret
		autocomplete="new-password"
		focus
		onenter={() => {
			if (allMet) pwPart = 'again';
		}}
	/>{/snippet}
{#snippet passwordDone(_: string)}<Done text="" secret onedit={() => (pwPart = 'new')} />{/snippet}
{#snippet confirmBlank(_: string)}<Blank
		id="rec-confirm"
		bind:value={confirm}
		label={m.auth_recover_confirm_label()}
		placeholder={m.auth_s_confirm_placeholder()}
		size={14}
		mono
		secret
		autocomplete="new-password"
		invalid={confirmBad}
		describedby="recover-confirm-msg"
		focus
		onenter={startRekey}
	/>{/snippet}
{#snippet pastProof()}<Clause text={m.auth_s_recover_account()} past slots={{ email: emailDone }} /><Clause lead
		text={m.auth_s_recover_phrase_ok()}
		past
	/>{/snippet}

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
			before={pastProof}
			onTotp={(code) => runRecoveryTwoFactor((p) => submitRecoveryTwoFactorTotp(p, code))}
			onBackupCode={(code) => runRecoveryTwoFactor((p) => submitRecoveryTwoFactorBackupCode(p, code))}
			onWebauthn={() => runRecoveryTwoFactor((p) => submitRecoveryTwoFactorWebauthn(p))}
			onBack={() => resetToPhraseStep('')}
		>
			{#snippet top()}
				<Trail items={recLabels2fa} current={2} />
			{/snippet}
		</TwoFactorChallenge>
	{/if}
{:else}
	<div class="sp">
		{#if step !== 'done' && step !== 'nophrase'}
			<Trail items={recLabels} current={step === 'working' ? recLabels.length : trailAt} />
		{/if}
		{#if step === 'account'}
			<p class="sent"><Clause text={m.auth_s_recover_account()} slots={{ email: emailBlank }} /></p>
			<div class="sp-under">
				<Status>{m.auth_s_recover_email_hint()}</Status>
				<div class="sp-acts">
					<Button variant="primary" size="lg" disabled={!emailValid} onclick={continueAccount}>{m.auth_sentence_next()}</Button>
				</div>
			</div>
		{:else if step === 'phrase'}
			<p class="sent">
				<Clause text={m.auth_s_recover_account()} past slots={{ email: emailDone }} /><Clause lead
					text={m.auth_s_recover_phrase()}
				/>
			</p>
			<div class="sp-under wide">
				<div class="sp-words">
					{#each words as w, i (i)}
						{@const wrong = phraseStatus === 'bad' && badWord(w)}
						<label class="sp-word" class:bad={wrong} style:--i={i}>
							<span class="n">{i + 1}</span>
							<input
								value={w}
								bind:this={inputs[i]}
								spellcheck="false"
								autocomplete="off"
								autocapitalize="none"
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
				<div class="sp-acts">
					<Button variant="primary" size="lg" disabled={!allFilled || phraseStatus === 'checking'} onclick={verifyPhrase}>
						<BusyLabel
							busy={phraseStatus === 'checking'}
							label={m.auth_recover_phrase_unlock()}
							pending={m.auth_recover_phrase_checking()}
						/>
					</Button>
					<button type="button" class="sp-quiet" disabled={phraseStatus === 'checking'} onclick={() => (step = 'nophrase')}>
						{m.auth_recover_no_phrase()}
					</button>
				</div>
			</div>
		{:else if step === 'nophrase'}
			<p class="sent sm">{m.auth_s_recover_nophrase()}</p>
			<div class="sp-under">
				<div class="sp-ways">
					<div><b>{m.auth_recover_way_device_title()}</b><span>{m.auth_recover_way_device_body()}</span></div>
					<div><b>{m.auth_recover_way_retry_title()}</b><span>{m.auth_recover_way_retry_body()}</span></div>
					<div><b>{m.auth_recover_way_reset_title()}</b><span>{m.auth_recover_way_reset_body()}</span></div>
				</div>
				<div class="sp-acts">
					<Button variant="secondary" size="lg" onclick={() => (step = 'phrase')}>{m.auth_recover_look_for_phrase()}</Button>
					<button type="button" class="sp-quiet" onclick={exitToLogin}>{m.auth_2fa_back_to_sign_in()}</button>
				</div>
			</div>
		{:else if step === 'password'}
			<p class="sent sm">
				{@render pastProof()}{#if pwPart === 'new'}<Clause lead
						text={m.auth_s_recover_password()}
						slots={{ password: passwordBlank }}
					/>{:else}<Clause
						lead
						text={m.auth_s_recover_password_again()}
						slots={{ password: passwordDone, confirm: confirmBlank }}
					/>{/if}
			</p>
			<div class="sp-under">
				{#if pwPart === 'new'}
					<div class="sp-status-box"><PasswordChecks {pw} /></div>
					<div class="sp-acts">
						<Button variant="primary" size="lg" disabled={!allMet} onclick={() => (pwPart = 'again')}>{m.auth_sentence_next()}</Button>
						<button type="button" class="sp-quiet" onclick={() => (step = 'phrase')}>{m.common_back()}</button>
					</div>
				{:else}
					<Status id="recover-confirm-msg" tone={confirmBad ? 'bad' : matches ? 'ok' : 'hint'}>
						{confirmBad ? m.auth_register_passwords_mismatch() : matches ? m.auth_register_passwords_match() : m.auth_s_confirm_hint()}
					</Status>
					<p class="sp-msg">{m.auth_s_recover_rewrap_note()}</p>
					<div class="sp-acts">
						<Button variant="primary" size="lg" disabled={!passwordReady} onclick={startRekey}>{m.auth_recover_reset_password()}</Button>
					</div>
				{/if}
			</div>
		{:else if step === 'working'}
			<p class="sent sm">{m.auth_s_recover_working()}</p>
			<div class="sp-under">
				<WorkSteps lines={workLines} at={workIdx} failed={!!workError} />
				{#if workError}
					<p class="sp-err" role="alert"><CircleAlert size={15} strokeWidth={1.75} /><span>{workError}</span></p>
					<div class="sp-acts">
						<Button variant="secondary" size="lg" onclick={startOver}>{m.auth_recover_start_over()}</Button>
						<button type="button" class="sp-quiet" onclick={exitToLogin}>{m.auth_2fa_back_to_sign_in()}</button>
					</div>
				{:else}
					<p class="sp-fine">{m.auth_s_recover_working_note()}</p>
				{/if}
			</div>
		{:else}
			<p class="sent sm">{m.auth_s_recover_done()}</p>
			<div class="sp-under">
				<p class="sp-msg ok"><CircleCheck size={14} strokeWidth={1.75} /><span>{m.auth_recover_done_signed_out()}</span></p>
				<p class="sp-msg ok"><CircleCheck size={14} strokeWidth={1.75} /><span>{m.auth_recover_done_phrase_retired()}</span></p>
				<div class="sp-acts">
					<Button variant="primary" size="lg" onclick={exitToLogin}>{m.auth_recover_done_sign_in()}</Button>
				</div>
			</div>
		{/if}
		{#if step === 'account' || step === 'phrase'}
			<div class="sp-foot">
				<span><Rich text={m.auth_recover_remembered()} tags={{ link: signInLink }} /></span>
			</div>
		{/if}
	</div>
{/if}
