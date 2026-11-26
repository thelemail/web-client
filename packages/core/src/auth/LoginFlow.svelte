<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { page } from '$app/state';
	import TextField from '$core/auth/form/TextField.svelte';
	import PasswordField from '$core/auth/PasswordField.svelte';
	import Status from '$core/auth/form/Status.svelte';
	import Icon from '$core/components/Icon.svelte';
	import { faCircleExclamation } from '@fortawesome/pro-regular-svg-icons';
	import { ApiCallError } from '$core/api/types';
	import {
		abandonTwoFactorLogin,
		performLogin,
		submitTwoFactorBackupCode,
		submitTwoFactorTotp,
		submitTwoFactorWebauthn,
		TwoFactorExpiredError,
		TwoFactorRejectedError,
		type PendingTwoFactorLogin,
		type PerformLoginOutcome
	} from '$core/auth/perform-login';
	import TwoFactorChallenge from '$core/auth/TwoFactorChallenge.svelte';
	import { unfold } from '$core/auth/form/unfold';
	import { webauthnFailure, webauthnFailureMessage } from '$core/auth/webauthn';
	import { isLoginIdentifier, loginIdentifier } from '$core/auth/login-identifier';
	import { auth } from '$core/stores/session.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	let {
		afterSignIn,
		intercept
	}: { afterSignIn: (slot: number) => Promise<unknown>; intercept?: (identifier: string) => Promise<boolean> } = $props();

	const addMode = $derived(page.url.searchParams.get('addAccount') === '1');
	const returnTo = $derived(page.url.searchParams.get('redirect'));
	const registerHref = $derived.by(() => {
		const q = new URLSearchParams();
		if (addMode) q.set('addAccount', '1');
		if (returnTo) q.set('redirect', returnTo);
		const s = q.toString();
		return s ? `/register?${s}` : '/register';
	});
	const targetSlot = $derived(page.url.searchParams.get('slot'));
	const hintEmail = $derived(page.url.searchParams.get('hint'));
	const resumeEmail = $derived.by(() => {
		const s = targetSlot ? Number(targetSlot) : null;
		if (s !== null && !Number.isNaN(s)) return accounts.bySlot(s)?.email ?? null;
		return !addMode && hintEmail && isLoginIdentifier(hintEmail) ? hintEmail : null;
	});
	const initialEmail = $derived(addMode ? '' : (auth.email ?? ''));

	let step = $state<'identify' | 'password'>('identify');
	let email = $state('');
	let identifier = $state('');
	let identifyError = $state<string | null>(null);
	let touched = false;
	let pw = $state('');
	let busy = $state(false);
	let sealed = $state(false);
	let verifying = $state(false);
	let loginError = $state<string | null>(null);
	let rememberMe = $state(false);
	let pendingTwoFactor = $state.raw<PendingTwoFactorLogin | null>(null);
	let twoFaBusy = $state(false);
	let twoFaError = $state<string | null>(null);
	let twoFaKeyNotice = $state<string | null>(null);
	let twoFaFailures = $state(0);
	let twoFaAgain = $state(false);
	let heldTwoFactor: PendingTwoFactorLogin | null = null;
	let attempt: AbortController | null = null;

	$effect(() => {
		const resume = resumeEmail;
		const next = initialEmail;
		untrack(() => {
			if (touched || busy || pendingTwoFactor) return;
			if (resume) {
				email = resume;
				identifier = loginIdentifier(resume);
				step = 'password';
			} else if (step === 'identify') {
				email = next;
			}
		});
	});

	$effect(() => () => {
		attempt?.abort();
		attempt = null;
	});

	const canSignIn = $derived(isLoginIdentifier(identifier) && pw.length >= 1);
	const unlocking = $derived(!addMode && !!resumeEmail && identifier === loginIdentifier(resumeEmail));
	const heading = $derived(
		addMode ? m.auth_login_add_title() : unlocking && step === 'password' ? m.auth_login_unlock_title() : m.auth_login_title()
	);
	const lede = $derived(
		addMode ? m.auth_s_add_note() : unlocking && step === 'password' ? m.auth_login_unlock_sub() : m.auth_login_sub()
	);

	function continueToPassword(e?: SubmitEvent) {
		e?.preventDefault();
		touched = true;
		if (!isLoginIdentifier(email)) {
			identifyError = m.auth_login_email_invalid();
			return;
		}
		identifyError = null;
		identifier = loginIdentifier(email);
		email = identifier;
		loginError = null;
		if (intercept) {
			void intercept(identifier)
				.catch(() => false)
				.then((handled) => {
					if (!handled && identifier === loginIdentifier(email)) step = 'password';
				});
			return;
		}
		step = 'password';
	}

	async function changeEmail() {
		if (busy) return;
		touched = true;
		attempt?.abort();
		attempt = null;
		pw = '';
		await resetToPasswordStep(null);
		identifyError = null;
		step = 'identify';
	}

	onDestroy(() => {
		pw = '';
	});

	async function navigateAfterLogin(slot: number) {
		sealed = true;
		try {
			await afterSignIn(slot);
		} catch (err) {
			sealed = false;
			throw err;
		}
	}

	function loginErrorMessage(err: unknown): string {
		if (err instanceof ApiCallError) {
			if (err.status === 401) return m.auth_login_wrong_credentials();
			if (err.envelope?.error.code === 'auth_origin_unavailable') {
				return m.auth_login_origin_unavailable();
			}
			if (err.status === 429) return m.auth_login_rate_limited();
			if (err.status === 503) return m.auth_login_busy();
			if (err.status === 422 && err.envelope?.error.code.startsWith('proof_')) return m.auth_proof_failed();
			return m.auth_login_failed_http({ status: err.status });
		}
		return err instanceof Error ? err.message : m.auth_login_failed();
	}

	async function submit(e?: SubmitEvent) {
		e?.preventDefault();
		if (!canSignIn || busy) return;
		const current = new AbortController();
		attempt = current;
		busy = true;
		loginError = null;
		const password = pw;
		try {
			const outcome = await performLogin({
				email: identifier,
				password,
				rememberMe,
				signal: current.signal,
				onVerifying: (active) => {
					if (attempt === current) verifying = active;
				}
			});
			if (attempt !== current) {
				if (outcome.status === 'twoFactorRequired') await abandonTwoFactorLogin(outcome.pending);
				return;
			}
			if (outcome.status === 'twoFactorRequired') {
				pw = '';
				heldTwoFactor = outcome.pending;
				pendingTwoFactor = outcome.pending;
				twoFaError = null;
				twoFaKeyNotice = null;
				twoFaFailures = 0;
				busy = false;
				return;
			}
			await navigateAfterLogin(outcome.result.slot);
			if (attempt === current) busy = false;
		} catch (err) {
			if (attempt !== current) return;
			console.error('login failed', err);
			loginError = loginErrorMessage(err);
			busy = false;
		} finally {
			if (attempt === current) verifying = false;
		}
	}

	async function resetToPasswordStep(message: string | null) {
		const held = heldTwoFactor;
		heldTwoFactor = null;
		if (held) await abandonTwoFactorLogin(held);
		pendingTwoFactor = null;
		twoFaError = null;
		twoFaKeyNotice = null;
		twoFaFailures = 0;
		twoFaAgain = false;
		twoFaBusy = false;
		loginError = message;
	}

	async function runTwoFactor(fn: (pending: PendingTwoFactorLogin) => Promise<PerformLoginOutcome>) {
		const pending = pendingTwoFactor;
		if (!pending || twoFaBusy) return;
		if (Date.now() > pending.expiresAt) {
			await resetToPasswordStep(m.auth_login_2fa_expired());
			return;
		}
		twoFaBusy = true;
		twoFaError = null;
		twoFaKeyNotice = null;
		try {
			const outcome = await fn(pending);
			if (heldTwoFactor === pending) heldTwoFactor = null;
			if (outcome.status === 'twoFactorRequired') {
				heldTwoFactor = outcome.pending;
				pendingTwoFactor = outcome.pending;
				twoFaAgain = true;
				twoFaFailures = 0;
				twoFaBusy = false;
				return;
			}
			await navigateAfterLogin(outcome.result.slot);
		} catch (err) {
			if (err instanceof TwoFactorRejectedError) {
				twoFaFailures += 1;
				if (twoFaFailures >= 5 || Date.now() > pending.expiresAt) {
					await resetToPasswordStep(m.auth_login_2fa_expired());
					return;
				}
				twoFaError = m.auth_login_2fa_rejected();
				twoFaBusy = false;
				return;
			}
			if (err instanceof TwoFactorExpiredError) {
				await resetToPasswordStep(m.auth_login_2fa_expired());
				return;
			}
			const failure = webauthnFailure(err);
			if (failure) {
				if (failure !== 'aborted') twoFaKeyNotice = webauthnFailureMessage(failure);
				twoFaBusy = false;
				return;
			}
			console.error('two-factor failed', err);
			twoFaError = m.auth_login_2fa_failed();
			twoFaBusy = false;
		}
	}

	$effect(() => {
		const pending = pendingTwoFactor;
		if (!pending) return;
		const expire = () => {
			if (twoFaBusy) expiry = setTimeout(expire, 1000);
			else void resetToPasswordStep(m.auth_login_2fa_expired());
		};
		let expiry = setTimeout(expire, Math.max(0, pending.expiresAt - Date.now()));
		const onPageHide = () => void resetToPasswordStep(null);
		window.addEventListener('pagehide', onPageHide);
		return () => {
			clearTimeout(expiry);
			window.removeEventListener('pagehide', onPageHide);
			if (heldTwoFactor === pending) {
				heldTwoFactor = null;
				void abandonTwoFactorLogin(pending);
			}
		};
	});
</script>

{#snippet addr(t: string)}<span class="mono">{t}</span>{/snippet}
{#snippet registerLink(t: string)}<a href={registerHref}>{t}</a>{/snippet}
{#snippet changeLink()}<button type="button" class="aux" disabled={busy} onclick={changeEmail}>{m.auth_login_change_email()}</button>{/snippet}
{#snippet forgotLink()}<a class="aux" href={`/recover?email=${encodeURIComponent(identifier)}`}>{m.auth_login_forgot_password()}</a>{/snippet}

<svelte:head>
	<title>{m.auth_login_page_title()}</title>
</svelte:head>

{#if pendingTwoFactor}
	{#key pendingTwoFactor.pendingToken}
		<TwoFactorChallenge
			email={pendingTwoFactor.email}
			methods={pendingTwoFactor.methods}
			busy={twoFaBusy}
			{sealed}
			error={twoFaError}
			keyNotice={twoFaKeyNotice}
			onTotp={(code) => runTwoFactor((p) => submitTwoFactorTotp(p, code))}
			onBackupCode={(code) => runTwoFactor((p) => submitTwoFactorBackupCode(p, code))}
			onWebauthn={() => runTwoFactor((p) => submitTwoFactorWebauthn(p))}
			onBack={() => resetToPasswordStep(null)}
		>
			{#snippet lede()}
				{#if twoFaAgain}
					<Rich text={m.auth_login_2fa_again_lede({ email: pendingTwoFactor?.email ?? '' })} tags={{ addr }} />
				{/if}
			{/snippet}
		</TwoFactorChallenge>
	{/key}
{:else}
	<form class="card-surface" novalidate onsubmit={step === 'identify' ? continueToPassword : submit}>
		<div class="card-head">
			<h1>{heading}</h1>
			<p>{lede}</p>
		</div>
		{#if loginError}
			<p class="af-error" id="login-err" role="alert" transition:unfold><Icon icon={faCircleExclamation} size={16} /><span>{loginError}</span></p>
		{/if}
		{#if step === 'identify'}
			<TextField
				id="login-email"
				bind:value={email}
				type="email"
				label={m.common_email_address()}
				placeholder="you@yourdomain.com"
				mono
				autocomplete="username"
				invalid={!!identifyError}
				describedby="login-email-err"
				focus
				normalize={(raw) => {
					touched = true;
					identifyError = null;
					return raw.trim();
				}}
			/>
			<Status id="login-email-err" tone={identifyError ? 'bad' : 'hint'} reserve>{identifyError ?? ''}</Status>
			<Button type="submit" variant="primary" size="lg" block disabled={email.trim().length === 0}>
				{m.common_continue()}
			</Button>
		{:else}
			<TextField
				id="login-identifier"
				value={identifier}
				type="email"
				label={m.common_email_address()}
				mono
				autocomplete="username"
				readonly
				aux={changeLink}
			/>
			<div class="form" in:unfold>
			<PasswordField
				id="login-password"
				label={m.common_password()}
				bind:value={pw}
				autocomplete="current-password"
				invalid={!!loginError}
				describedby="login-err"
				disabled={busy}
				focus
				aux={forgotLink}
			/>
			<label class="af-tick">
				<input type="checkbox" class="check" bind:checked={rememberMe} disabled={busy} />
				<span>{m.auth_login_remember_me()}<small>{m.auth_login_remember_hint()}</small></span>
			</label>
			</div>
			{#if sealed}
				<div transition:unfold><Status tone="ok">{m.auth_login_signed_in()}</Status></div>
			{/if}
			<Button
				type="submit"
				variant="primary"
				size="lg"
				block
				disabled={!canSignIn || sealed}
				busy={busy && !sealed}
				busyLabel={verifying ? m.auth_login_verifying() : m.auth_login_signing_in()}
			>
				{m.auth_sign_in()}
			</Button>
		{/if}
		<p class="af-row"><Rich text={m.auth_login_new_to()} tags={{ link: registerLink }} /></p>
	</form>
{/if}
