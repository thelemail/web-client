<script lang="ts">
	import { platform } from '$platform';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PasswordField from '$lib/auth/PasswordField.svelte';
	import PasswordStrength from '$lib/auth/PasswordStrength.svelte';
	import { passwordReqs } from '$lib/auth/password-policy';
	import Stepper from '$lib/auth/Stepper.svelte';
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
	} from '$lib/auth/perform-recovery';
	import { TwoFactorExpiredError, TwoFactorRejectedError } from '$lib/auth/perform-login';
	import TwoFactorChallenge from '$lib/auth/TwoFactorChallenge.svelte';
	import { isWebauthnCancelled } from '$lib/auth/webauthn';
	import { keystore } from '$lib/keystore/keystore-client';
	import { validateMnemonic } from '@scure/bip39';
	import { wordlist } from '@scure/bip39/wordlists/english.js';
	import brandmark from '$lib/assets/logo-mark.svg';
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

	const REC_LABELS = ['Account', 'Phrase', 'Password'];
	const REC_LABELS_2FA = ['Account', 'Phrase', '2FA', 'Password'];
	const WORK_LINES = [
		'Opening your key with the recovery phrase',
		'Deriving a key from the new password',
		'Re-wrapping your private key',
		'Retiring the old phrase · signing out other sessions'
	];

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
	const recLabels = $derived(hadTwoFa ? REC_LABELS_2FA : REC_LABELS);

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
			phraseError =
				'That doesn’t look like a valid recovery phrase. Check the marked words — order and spelling both matter.';
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
					? 'That phrase doesn’t open this archive. Order and spelling both matter.'
					: 'Something went wrong on our end. Give it a moment and try again.';
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
			resetToPhraseStep('Your recovery session expired — enter your phrase again.');
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
					resetToPhraseStep('Your recovery session expired — enter your phrase again.');
					return;
				}
				twoFaError = 'That code didn’t work. Try again.';
				twoFaBusy = false;
				return;
			}
			if (err instanceof TwoFactorExpiredError) {
				resetToPhraseStep('Your recovery session expired — enter your phrase again.');
				return;
			}
			if (isWebauthnCancelled(err)) {
				twoFaBusy = false;
				return;
			}
			console.error('recovery two-factor failed', err);
			twoFaError = err instanceof Error ? err.message : 'Verification failed';
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
			workIdx = WORK_LINES.length;
			pw = '';
			confirm = '';
			resetToken = '';
			setTimeout(() => (step = 'done'), 500);
		} catch (err) {
			platform.reportError?.('recover', err);
			workError =
				err instanceof RecoveryResetExpiredError
					? 'This recovery session expired. Start over and enter your phrase again.'
					: 'Something went wrong while re-keying. Start over and try again.';
		}
	}

	const workPct = $derived(Math.min(100, Math.round((workIdx / WORK_LINES.length) * 100)));
</script>

<svelte:head>
	<title>Thelemail — Account recovery</title>
</svelte:head>

{#if step === 'account'}
	<div class="card-surface screen-fade">
		<Stepper step={0} labels={REC_LABELS} />
		<div class="card-head">
			<p class="eyebrow">Account recovery</p>
			<h1>Recover your account</h1>
			<p>
				Your mail is zero-access encrypted &mdash; we never hold your password or a copy of your
				key, so there is no reset we can send you.
			</p>
		</div>
		<div class="form">
			<div class="keynote">
				<KeyRound size={16} strokeWidth={1.75} />
				<span>
					Your <b>twelve-word recovery phrase</b> is the spare key. With it, you&rsquo;ll set a new
					password and nothing is lost.
				</span>
			</div>
			<div class="field">
				<div class="lab"><label for="rec-email">Email address</label></div>
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
				<span class="hint">
					We won&rsquo;t say whether an address exists &mdash; the phrase decides.
				</span>
			</div>
			<div class="actions">
				<button class="btn btn-primary btn-block" disabled={!emailValid} onclick={continueAccount}>
					Continue<ArrowRight size={17} strokeWidth={1.75} />
				</button>
			</div>
		</div>
		<p class="switch">Remembered it after all? <a href="/login">Back to sign in</a></p>
	</div>
{:else if step === 'phrase'}
	<div class="card-surface screen-fade">
		<Stepper step={1} labels={recLabels} />
		<div class="card-head">
			<p class="eyebrow">Account recovery</p>
			<h1>Enter your recovery phrase</h1>
			<p>
				The twelve words you wrote down when you set up recovery for
				<span class="mono" style="color:var(--ink-700)">{email}</span> &mdash; in order.
			</p>
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
				<span class="hint">Tip: paste the whole phrase into any box and it will fill itself in.</span>
			{/if}
			<div class="actions">
				<div class="btnrow">
					<button
						class="btn btn-secondary btn-back"
						aria-label="Back"
						onclick={() => (step = 'account')}
					>
						<ArrowLeft size={17} strokeWidth={1.75} />
					</button>
					<button
						class="btn btn-primary"
						disabled={!allFilled || phraseStatus === 'checking'}
						onclick={verifyPhrase}
					>
						{#if phraseStatus === 'checking'}
							<span class="spinner"></span>Checking the phrase&hellip;
						{:else}
							Unlock with phrase<ArrowRight size={17} strokeWidth={1.75} />
						{/if}
					</button>
				</div>
			</div>
		</div>
		<p class="switch">
			<button class="linklike" type="button" onclick={() => (step = 'nophrase')}>
				I don&rsquo;t have my phrase
			</button>
		</p>
	</div>
{:else if step === 'nophrase'}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">Account recovery</p>
			<h1>Without your phrase</h1>
			<p>
				We&rsquo;ll be straight with you: there is no back door. Your mail is encrypted to a key
				only your password or your phrase can open. Here is what can still help.
			</p>
		</div>
		<div class="ways">
			<div class="way">
				<span class="way-ic"><MonitorSmartphone size={17} strokeWidth={1.75} /></span>
				<div class="way-text">
					<b>Still signed in somewhere?</b>
					A signed-in device holds your unlocked key. Open Settings &rarr; Security there and set up
					a fresh recovery phrase &mdash; no password needed.
				</div>
			</div>
			<div class="way">
				<span class="way-ic"><RotateCcw size={17} strokeWidth={1.75} /></span>
				<div class="way-text">
					<b>Take another run at the password.</b>
					People often recall it with time. Try old variants, your password manager, the drawer with
					the notebook.
				</div>
			</div>
			<div class="way danger">
				<span class="way-ic"><CircleAlert size={17} strokeWidth={1.75} /></span>
				<div class="way-text">
					<b>Last resort: start the account over.</b>
					Your address and domains stay yours, but the encrypted archive is destroyed &mdash; we
					can&rsquo;t decrypt it, not even to save it.
				</div>
			</div>
		</div>
		<div class="actions" style="margin-top:22px">
			<button class="btn btn-secondary btn-block" onclick={() => (step = 'phrase')}>
				<ArrowLeft size={17} strokeWidth={1.75} />I&rsquo;ll look for the phrase
			</button>
			<button class="btn btn-ghost btn-block" onclick={exitToLogin}>Back to sign in</button>
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
				eyebrow="Account recovery"
				backLabel="Back"
				onTotp={(code) => runRecoveryTwoFactor((p) => submitRecoveryTwoFactorTotp(p, code))}
				onBackupCode={(code) =>
					runRecoveryTwoFactor((p) => submitRecoveryTwoFactorBackupCode(p, code))}
				onWebauthn={() => runRecoveryTwoFactor((p) => submitRecoveryTwoFactorWebauthn(p))}
				onBack={() => resetToPhraseStep('')}
			>
				{#snippet top()}
					<Stepper step={2} labels={REC_LABELS_2FA} />
				{/snippet}
				{#snippet lede()}
					This account has two-factor enabled. The phrase checked out &mdash; confirm a second
					factor for <span class="mono" style="color:var(--ink-700)">{email}</span> before the
					reset.
				{/snippet}
			</TwoFactorChallenge>
		{/if}
	</div>
{:else if step === 'password'}
	<div class="card-surface screen-fade">
		<Stepper step={hadTwoFa ? 3 : 2} labels={recLabels} />
		<div class="card-head">
			<p class="eyebrow">Account recovery</p>
			<h1>Set a new password</h1>
			<p>The phrase opened your key. Now choose the password that will wrap it from here on.</p>
		</div>
		<div class="form">
			<PasswordField
				label="New password"
				bind:value={pw}
				placeholder="Create a strong password"
				autocomplete="new-password"
			/>
			<PasswordStrength {pw} />
			<PasswordField
				label="Confirm new password"
				bind:value={confirm}
				placeholder="Re-enter password"
				autocomplete="new-password"
				onEnter={startRekey}
			/>
			{#if mismatch}
				<span class="errtext" style="margin-top:-8px">
					<CircleAlert size={13} strokeWidth={1.75} />
					<span>Passwords don&rsquo;t match.</span>
				</span>
			{:else if matches}
				<span class="oktext" style="margin-top:-8px">
					<CircleCheck size={13} strokeWidth={1.75} />
					<span>Passwords match.</span>
				</span>
			{/if}
			<div class="keynote">
				<KeyRound size={16} strokeWidth={1.75} />
				<span>
					This re-wraps your private key. Other devices sign out, and <b>your old phrase is
						retired</b> &mdash; you&rsquo;ll set up a fresh one after you&rsquo;re back in.
				</span>
			</div>
			<div class="actions">
				<div class="btnrow">
					<button
						class="btn btn-secondary btn-back"
						aria-label="Back"
						onclick={() => (step = 'phrase')}
					>
						<ArrowLeft size={17} strokeWidth={1.75} />
					</button>
					<button class="btn btn-primary" disabled={!passwordReady} onclick={startRekey}>
						Reset password<ArrowRight size={17} strokeWidth={1.75} />
					</button>
				</div>
			</div>
		</div>
	</div>
{:else if step === 'working'}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">Account recovery</p>
			<h1>Re-keying your archive</h1>
		</div>
		<div class="working">
			<div class="wbar"><i style="width:{workPct}%"></i></div>
			<ul class="wlines">
				{#each WORK_LINES as line, j (j)}
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
					<button class="btn btn-secondary btn-block" onclick={startOver}>
						<RotateCcw size={15} strokeWidth={1.75} />Start over
					</button>
					<button class="btn btn-ghost btn-block" onclick={exitToLogin}>Back to sign in</button>
				</div>
			{/if}
		</div>
	</div>
{:else}
	<div class="card-surface screen-fade">
		<div class="welcome">
			<img class="brandmark brandmark-lg" src={brandmark} alt="Thelemail" />
			<h1>Your archive is back</h1>
			<p>The phrase did its job. Every message is intact, re-encrypted under your new password.</p>
			<div class="addrcard">
				<span class="av"><KeyRound size={16} strokeWidth={1.75} /></span>
				<span class="em">{email}</span>
				<span class="vbadge"><Check size={13} strokeWidth={2.5} /></span>
			</div>
			<div class="recnotes">
				<span class="recnote">
					<LogOut size={14} strokeWidth={1.75} />
					Other devices were signed out &mdash; unlock them with the new password
				</span>
				<span class="recnote brass">
					<LifeBuoy size={14} strokeWidth={1.75} />
					Your old phrase is retired. Set up a new one in Settings &rarr; Security
				</span>
			</div>
			<div class="actions" style="margin-top:24px">
				<button class="btn btn-primary btn-block" onclick={exitToLogin}>
					<Mail size={17} strokeWidth={1.75} />Sign in with your new password
				</button>
			</div>
		</div>
	</div>
{/if}
