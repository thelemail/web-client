<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PasswordField from '$core/auth/PasswordField.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Check from '@lucide/svelte/icons/check';
	import { ApiCallError } from '$core/api/types';
	import {
		abandonTwoFactorLogin,
		performLogin,
		submitTwoFactorBackupCode,
		submitTwoFactorTotp,
		submitTwoFactorWebauthn,
		TwoFactorExpiredError,
		TwoFactorRejectedError,
		type PendingTwoFactorLogin
	} from '$core/auth/perform-login';
	import TwoFactorChallenge from '$core/auth/TwoFactorChallenge.svelte';
	import { webauthnFailure, webauthnFailureMessage } from '$core/auth/webauthn';
	import { resolveReturnTo } from '$core/auth/return-to';
	import { isLoginIdentifier, loginIdentifier } from '$core/auth/login-identifier';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import { Button } from '$core/components/ui/button';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

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
	const resumeEmail = $derived.by(() => {
		const s = targetSlot ? Number(targetSlot) : null;
		if (s === null || Number.isNaN(s)) return null;
		return accounts.bySlot(s)?.email ?? null;
	});
	const initialEmail = $derived(addMode ? '' : (auth.email ?? ''));

	let step = $state<'identify' | 'password'>('identify');
	let email = $state('');
	let identifier = $state('');
	let identifyError = $state<string | null>(null);
	let touched = false;
	let pw = $state('');
	let busy = $state(false);
	let verifying = $state(false);
	let loginError = $state<string | null>(null);
	let rememberMe = $state(false);
	let pendingTwoFactor = $state.raw<PendingTwoFactorLogin | null>(null);
	let twoFaBusy = $state(false);
	let twoFaError = $state<string | null>(null);
	let twoFaKeyNotice = $state<string | null>(null);
	let twoFaFailures = $state(0);
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

	async function navigateAfterLogin(slot: number) {
		await goto(resolveReturnTo(page.url.searchParams.get('redirect'), slot));
	}

	function loginErrorMessage(err: unknown): string {
		if (err instanceof ApiCallError) {
			if (err.status === 401) return m.auth_login_wrong_credentials();
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
			pw = '';
			if (outcome.status === 'twoFactorRequired') {
				heldTwoFactor = outcome.pending;
				pendingTwoFactor = outcome.pending;
				twoFaError = null;
				twoFaKeyNotice = null;
				twoFaFailures = 0;
				busy = false;
				return;
			}
			await navigateAfterLogin(outcome.result.slot);
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
		twoFaBusy = false;
		loginError = message;
	}

	async function runTwoFactor(fn: (pending: PendingTwoFactorLogin) => Promise<{ slot: number }>) {
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
			const { slot } = await fn(pending);
			if (heldTwoFactor === pending) heldTwoFactor = null;
			await navigateAfterLogin(slot);
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

{#snippet addr(t: string)}<span class="mono" style="color:var(--ink-700)">{t}</span>{/snippet}
{#snippet registerLink(t: string)}<a href={registerHref}>{t}</a>{/snippet}

<svelte:head>
	<title>{m.auth_login_page_title()}</title>
</svelte:head>

{#if pendingTwoFactor}
	<div class="card-surface screen-fade">
		<TwoFactorChallenge
			email={pendingTwoFactor.email}
			methods={pendingTwoFactor.methods}
			busy={twoFaBusy}
			error={twoFaError}
			keyNotice={twoFaKeyNotice}
			onTotp={(code) => runTwoFactor((p) => submitTwoFactorTotp(p, code))}
			onBackupCode={(code) => runTwoFactor((p) => submitTwoFactorBackupCode(p, code))}
			onWebauthn={() => runTwoFactor((p) => submitTwoFactorWebauthn(p))}
			onBack={() => resetToPasswordStep(null)}
		>
			{#snippet lede()}
				<Rich
					text={m.auth_login_2fa_lede({ email: pendingTwoFactor?.email ?? '' })}
					tags={{ addr }}
				/>
			{/snippet}
		</TwoFactorChallenge>
	</div>
{:else}
	<div class="card-surface screen-fade">
		<div class="card-head">
			{#if addMode}
				<p class="eyebrow">{m.auth_login_add_eyebrow()}</p>
				<h1>{m.auth_login_add_title()}</h1>
				<p>{m.auth_login_add_lede()}</p>
			{:else if resumeEmail && identifier === loginIdentifier(resumeEmail)}
				<p class="eyebrow">{m.auth_login_resume_eyebrow()}</p>
				<h1>{m.auth_login_resume_title()}</h1>
				<p>{m.auth_login_resume_lede()}</p>
			{:else}
				<p class="eyebrow">{m.auth_login_eyebrow()}</p>
				<h1>{m.auth_login_title()}</h1>
			{/if}
		</div>
		{#if step === 'identify'}
			<form class="form" novalidate onsubmit={continueToPassword}>
				<div class="field">
					<div class="lab"><label for="login-email">{m.common_email_address()}</label></div>
					<input
						id="login-email"
						class={['inp', { err: !!identifyError }]}
						type="email"
						bind:value={email}
						placeholder="you@yourdomain.com"
						autocomplete="username"
						spellcheck="false"
						aria-invalid={identifyError ? true : undefined}
						aria-describedby={identifyError ? 'login-email-err' : undefined}
						oninput={() => {
							touched = true;
							identifyError = null;
						}}
						{@attach (node) => node.focus()}
					/>
					{#if identifyError}
						<span class="errtext" role="alert" id="login-email-err">
							<CircleAlert size={13} strokeWidth={1.75} />
							<span>{identifyError}</span>
						</span>
					{/if}
				</div>
				<div class="actions">
					<Button type="submit" variant="primary" size="lg" block disabled={email.trim().length === 0}>
						{m.common_continue()}<ArrowRight size={17} strokeWidth={1.75} />
					</Button>
				</div>
			</form>
		{:else}
			<form class="form" novalidate onsubmit={submit}>
				<div class="field">
					<div class="lab">
						<label for="login-identifier">{m.common_email_address()}</label>
						<button type="button" class="aux" disabled={busy} onclick={changeEmail}>
							{m.auth_login_change_email()}
						</button>
					</div>
					<input
						id="login-identifier"
						class="inp"
						type="email"
						value={identifier}
						readonly
						autocomplete="username"
					/>
				</div>
				<PasswordField
					label={m.common_password()}
					bind:value={pw}
					placeholder={m.auth_login_password_placeholder()}
					autocomplete="current-password"
					focusOnMount
					invalid={!!loginError}
					describedby={loginError ? 'login-err' : undefined}
				>
					{#snippet aux()}
						<a class="aux" href={`/recover?email=${encodeURIComponent(identifier)}`}>
							{m.auth_login_forgot_password()}
						</a>
					{/snippet}
				</PasswordField>
				{#if loginError}
					<span class="errtext" role="alert" id="login-err" style="margin-top:-8px">
						<CircleAlert size={13} strokeWidth={1.75} />
						<span>{loginError}</span>
					</span>
				{/if}
				<label class="remember">
					<input type="checkbox" bind:checked={rememberMe} />
					<span class="box"><Check size={13} strokeWidth={2.5} /></span>
					{m.auth_login_remember_me()}
				</label>
				<div class="actions">
					<Button type="submit" variant="primary" size="lg" block disabled={!canSignIn || busy}>
						{#if busy}
							<span class="spinner"></span>{verifying ? m.auth_login_verifying() : m.auth_login_signing_in()}
						{:else}
							{m.auth_sign_in()}
						{/if}
					</Button>
				</div>
			</form>
		{/if}
		<p class="switch">
			<Rich text={m.auth_login_new_to()} tags={{ link: registerLink }} />
		</p>
	</div>
{/if}
