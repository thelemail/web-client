<script lang="ts">
	import { platform } from '$platform';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PasswordField from '$core/auth/PasswordField.svelte';
	import PasswordStrength from '$core/auth/PasswordStrength.svelte';
	import { passwordReqs } from '$core/auth/password-policy';
	import Stepper from '$core/auth/Stepper.svelte';
	import {
		completeRecoveryReset,
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
	import { isWebauthnCancelled } from '$core/auth/webauthn';
	import { keystore } from '$core/keystore/keystore-client';
	import { validateMnemonic } from '@scure/bip39';
	import { wordlist } from '@scure/bip39/wordlists/english.js';
	import brandmark from '$core/assets/logo-mark.svg';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Check from '@lucide/svelte/icons/check';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import LogOut from '@lucide/svelte/icons/log-out';
	import LifeBuoy from '@lucide/svelte/icons/life-buoy';
	import Mail from '@lucide/svelte/icons/mail';
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

	let pendingTwoFactor = $state<PendingTwoFactorRecovery | null>(null);
	let twoFaBusy = $state(false);
	let twoFaError = $state<string | null>(null);
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

	let pw = $state('');
	let confirm = $state('');
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
			phraseError = m.auth_recover_phrase_invalid();
			return;
		}
		phraseStatus = 'checking';
		phraseError = '';
		try {
			const outcome = await verifyRecoveryPhrase({ email, phrase });
			phraseStatus = 'idle';
			if (outcome.status === 'twoFactorRequired') {
				pendingTwoFactor = outcome.pending;
				twoFaError = null;
				twoFaFailures = 0;
				hadTwoFa = true;
				step = 'twofa';
				return;
			}
			applyRecoveryResult(outcome.result);
		} catch (err) {
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
		recoveredAccountId = res.accountId;
		pendingTwoFactor = null;
		step = 'password';
	}

	function resetToPhraseStep(message: string) {
		void keystore.discardRecovery();
		pendingTwoFactor = null;
		twoFaBusy = false;
		twoFaError = null;
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
			if (isWebauthnCancelled(err)) {
				twoFaBusy = false;
				return;
			}
			console.error('recovery two-factor failed', err);
			twoFaError = err instanceof Error ? err.message : m.auth_login_2fa_failed();
			twoFaBusy = false;
		}
	}

	$effect(() => {
		if (step === 'phrase') inputs[0]?.focus();
	});

	const allMet = $derived(passwordReqs(pw).every((r) => r.met));
	const matches = $derived(confirm.length > 0 && confirm === pw);
	const mismatch = $derived(confirm.length > 0 && confirm !== pw);
	const passwordReady = $derived(allMet && matches);

	function startOver() {
		void keystore.discardRecovery();
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

	const workPct = $derived(Math.min(100, Math.round((workIdx / workLines.length) * 100)));
</script>

{#snippet bold(t: string)}<b>{t}</b>{/snippet}
{#snippet addr(t: string)}<span class="mono" style="color:var(--ink-700)">{t}</span>{/snippet}
{#snippet signInLink(t: string)}<a href="/login">{t}</a>{/snippet}

<svelte:head>
	<title>{m.auth_recover_page_title()}</title>
</svelte:head>

{#if step === 'account'}
	<div class="card-surface screen-fade">
		<Stepper step={0} labels={recLabelsBase} />
		<div class="card-head">
			<p class="eyebrow">{m.auth_recover_eyebrow()}</p>
			<h1>{m.auth_recover_title()}</h1>
			<p>{m.auth_recover_lede()}</p>
		</div>
		<div class="form">
			<div class="keynote">
				<KeyRound size={16} strokeWidth={1.75} />
				<span><Rich text={m.auth_recover_keynote()} tags={{ b: bold }} /></span>
			</div>
			<div class="field">
				<div class="lab"><label for="rec-email">{m.common_email_address()}</label></div>
				<input
					id="rec-email"
					class="inp"
					type="email"
					bind:value={email}
					placeholder="you@yourdomain.com"
					autocomplete="username"
					onkeydown={(e) => {
						if (e.key === 'Enter') continueAccount();
					}}
				/>
				<span class="hint">{m.auth_recover_email_hint()}</span>
			</div>
			<div class="actions">
				<Button variant="primary" size="lg" block disabled={!emailValid} onclick={continueAccount}>
					{m.common_continue()}<ArrowRight size={17} strokeWidth={1.75} />
				</Button>
			</div>
		</div>
		<p class="switch">
			<Rich text={m.auth_recover_remembered()} tags={{ link: signInLink }} />
		</p>
	</div>
{:else if step === 'phrase'}
	<div class="card-surface screen-fade">
		<Stepper step={1} labels={recLabels} />
		<div class="card-head">
			<p class="eyebrow">{m.auth_recover_eyebrow()}</p>
			<h1>{m.auth_recover_phrase_title()}</h1>
			<p><Rich text={m.auth_recover_phrase_lede({ email })} tags={{ addr }} /></p>
		</div>
		<div class="form">
			<div class="phrasegrid" class:shake={phraseStatus === 'bad'}>
				{#each words as w, i (i)}
					{@const wrong = phraseStatus === 'bad' && badWord(w)}
					<label class="pword" class:err={wrong}>
						<span class="n">{i + 1}</span>
						<input
							value={w}
							bind:this={inputs[i]}
							spellcheck="false"
							autocomplete="off"
							autocapitalize="none"
							oninput={(e) => setWord(i, e.currentTarget.value)}
							onpaste={(e) => onPhrasePaste(i, e)}
							onkeydown={(e) => onPhraseKey(i, e)}
						/>
					</label>
				{/each}
			</div>
			{#if phraseStatus === 'bad'}
				<span class="errtext">
					<CircleAlert size={13} strokeWidth={1.75} />
					<span>{phraseError}</span>
				</span>
			{:else}
				<span class="hint">{m.auth_recover_phrase_tip()}</span>
			{/if}
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label={m.common_back()} onclick={() => (step = 'account')}>
						<ArrowLeft size={17} strokeWidth={1.75} />
					</Button>
					<Button variant="primary" size="lg" disabled={!allFilled || phraseStatus === 'checking'} onclick={verifyPhrase}>
						{#if phraseStatus === 'checking'}
							<span class="spinner"></span>{m.auth_recover_phrase_checking()}
						{:else}
							{m.auth_recover_phrase_unlock()}<ArrowRight size={17} strokeWidth={1.75} />
						{/if}
					</Button>
				</div>
			</div>
		</div>
		<p class="switch">
			<button class="linklike" type="button" onclick={() => (step = 'nophrase')}>
				{m.auth_recover_no_phrase()}
			</button>
		</p>
	</div>
{:else if step === 'nophrase'}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">{m.auth_recover_eyebrow()}</p>
			<h1>{m.auth_recover_nophrase_title()}</h1>
			<p>{m.auth_recover_nophrase_lede()}</p>
		</div>
		<div class="ways">
			<div class="way">
				<span class="way-ic"><MonitorSmartphone size={17} strokeWidth={1.75} /></span>
				<div class="way-text">
					<b>{m.auth_recover_way_device_title()}</b>
					{m.auth_recover_way_device_body()}
				</div>
			</div>
			<div class="way">
				<span class="way-ic"><RotateCcw size={17} strokeWidth={1.75} /></span>
				<div class="way-text">
					<b>{m.auth_recover_way_retry_title()}</b>
					{m.auth_recover_way_retry_body()}
				</div>
			</div>
			<div class="way danger">
				<span class="way-ic"><CircleAlert size={17} strokeWidth={1.75} /></span>
				<div class="way-text">
					<b>{m.auth_recover_way_reset_title()}</b>
					{m.auth_recover_way_reset_body()}
				</div>
			</div>
		</div>
		<div class="actions" style="margin-top:22px">
			<Button variant="secondary" size="lg" block onclick={() => (step = 'phrase')}>
				<ArrowLeft size={17} strokeWidth={1.75} />{m.auth_recover_look_for_phrase()}
			</Button>
			<Button variant="ghost" size="lg" block onclick={exitToLogin}>{m.auth_2fa_back_to_sign_in()}</Button>
		</div>
	</div>
{:else if step === 'twofa'}
	<div class="card-surface screen-fade">
		{#if pendingTwoFactor}
			<TwoFactorChallenge
				{email}
				methods={pendingTwoFactor.methods}
				busy={twoFaBusy}
				error={twoFaError}
				eyebrow={m.auth_recover_eyebrow()}
				backLabel={m.common_back()}
				onTotp={(code) => runRecoveryTwoFactor((p) => submitRecoveryTwoFactorTotp(p, code))}
				onBackupCode={(code) =>
					runRecoveryTwoFactor((p) => submitRecoveryTwoFactorBackupCode(p, code))}
				onWebauthn={() => runRecoveryTwoFactor((p) => submitRecoveryTwoFactorWebauthn(p))}
				onBack={() => resetToPhraseStep('')}
			>
				{#snippet top()}
					<Stepper step={2} labels={recLabels2fa} />
				{/snippet}
				{#snippet lede()}
					<Rich text={m.auth_recover_2fa_lede({ email })} tags={{ addr }} />
				{/snippet}
			</TwoFactorChallenge>
		{/if}
	</div>
{:else if step === 'password'}
	<div class="card-surface screen-fade">
		<Stepper step={hadTwoFa ? 3 : 2} labels={recLabels} />
		<div class="card-head">
			<p class="eyebrow">{m.auth_recover_eyebrow()}</p>
			<h1>{m.auth_recover_password_title()}</h1>
			<p>{m.auth_recover_password_lede()}</p>
		</div>
		<div class="form">
			<PasswordField
				label={m.auth_recover_new_password_label()}
				bind:value={pw}
				placeholder={m.auth_register_password_placeholder()}
				autocomplete="new-password"
			/>
			<PasswordStrength {pw} />
			<PasswordField
				label={m.auth_recover_confirm_label()}
				bind:value={confirm}
				placeholder={m.auth_register_confirm_placeholder()}
				autocomplete="new-password"
				onEnter={startRekey}
			/>
			{#if mismatch}
				<span class="errtext" style="margin-top:-8px">
					<CircleAlert size={13} strokeWidth={1.75} />
					<span>{m.auth_register_passwords_mismatch()}</span>
				</span>
			{:else if matches}
				<span class="oktext" style="margin-top:-8px">
					<CircleCheck size={13} strokeWidth={1.75} />
					<span>{m.auth_register_passwords_match()}</span>
				</span>
			{/if}
			<div class="keynote">
				<KeyRound size={16} strokeWidth={1.75} />
				<span><Rich text={m.auth_recover_rewrap_note()} tags={{ b: bold }} /></span>
			</div>
			<div class="actions">
				<div class="btnrow">
					<Button variant="secondary" size="lg" class="btn-back" aria-label={m.common_back()} onclick={() => (step = 'phrase')}>
						<ArrowLeft size={17} strokeWidth={1.75} />
					</Button>
					<Button variant="primary" size="lg" disabled={!passwordReady} onclick={startRekey}>
						{m.auth_recover_reset_password()}<ArrowRight size={17} strokeWidth={1.75} />
					</Button>
				</div>
			</div>
		</div>
	</div>
{:else if step === 'working'}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">{m.auth_recover_eyebrow()}</p>
			<h1>{m.auth_recover_working_title()}</h1>
		</div>
		<div class="working">
			<div class="wbar"><i style="width:{workPct}%"></i></div>
			<ul class="wlines">
				{#each workLines as line, j (j)}
					<li class:done={j < workIdx} class:active={j === workIdx && !workError}>
						<span class="wic">
							{#if j < workIdx}
								<Check size={13} strokeWidth={2.5} />
							{:else if j === workIdx && !workError}
								<span class="spinner"></span>
							{:else}
								<span class="pend"></span>
							{/if}
						</span>
						{line}
					</li>
				{/each}
			</ul>
			{#if workError}
				<span class="errtext" style="margin-top:16px">
					<CircleAlert size={13} strokeWidth={1.75} />
					<span>{workError}</span>
				</span>
				<div class="actions" style="margin-top:18px">
					<Button variant="secondary" size="lg" block onclick={startOver}>
						<RotateCcw size={15} strokeWidth={1.75} />{m.auth_recover_start_over()}
					</Button>
					<Button variant="ghost" size="lg" block onclick={exitToLogin}>{m.auth_2fa_back_to_sign_in()}</Button>
				</div>
			{/if}
		</div>
	</div>
{:else}
	<div class="card-surface screen-fade">
		<div class="welcome">
			<img class="brandmark brandmark-lg" src={brandmark} alt="Thelemail" />
			<h1>{m.auth_recover_done_title()}</h1>
			<p>{m.auth_recover_done_lede()}</p>
			<div class="addrcard">
				<span class="av"><KeyRound size={16} strokeWidth={1.75} /></span>
				<span class="em">{email}</span>
				<span class="vbadge"><Check size={13} strokeWidth={2.5} /></span>
			</div>
			<div class="recnotes">
				<span class="recnote">
					<LogOut size={14} strokeWidth={1.75} />
					{m.auth_recover_done_signed_out()}
				</span>
				<span class="recnote brass">
					<LifeBuoy size={14} strokeWidth={1.75} />
					{m.auth_recover_done_phrase_retired()}
				</span>
			</div>
			<div class="actions" style="margin-top:24px">
				<Button variant="primary" size="lg" block onclick={exitToLogin}>
					<Mail size={17} strokeWidth={1.75} />{m.auth_recover_done_sign_in()}
				</Button>
			</div>
		</div>
	</div>
{/if}
