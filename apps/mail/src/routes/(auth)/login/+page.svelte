<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PasswordField from '$core/auth/PasswordField.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Globe from '@lucide/svelte/icons/globe';
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
	import { isWebauthnCancelled } from '$core/auth/webauthn';
	import { resolveReturnTo } from '$core/auth/return-to';
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
	const slotAccountEmail = $derived(() => {
		const s = targetSlot ? Number(targetSlot) : null;
		if (s === null || Number.isNaN(s)) return null;
		return accounts.bySlot(s)?.email ?? null;
	});
	const initialEmail = $derived(slotAccountEmail() ?? (addMode ? '' : auth.email ?? ''));

	let email = $state('');
	let pw = $state('');
	let view = $state<'main' | 'sso'>('main');
	let ssoDomain = $state('');
	let busy = $state(false);
	let loginError = $state<string | null>(null);
	let rememberMe = $state(false);
	let pendingTwoFactor = $state<PendingTwoFactorLogin | null>(null);
	let twoFaBusy = $state(false);
	let twoFaError = $state<string | null>(null);
	let twoFaFailures = $state(0);

	$effect(() => {
		const next = initialEmail;
		if (!busy && pw.length === 0) email = next;
	});

	const emailValid = $derived(/\S+@\S+\.\S+/.test(email));
	const canSignIn = $derived(emailValid && pw.length >= 1);

	async function navigateAfterLogin(slot: number) {
		await goto(resolveReturnTo(page.url.searchParams.get('redirect'), slot));
	}

	async function submit() {
		if (!canSignIn || busy) return;
		busy = true;
		loginError = null;
		const password = pw;
		try {
			const outcome = await performLogin({ email, password, rememberMe });
			pw = '';
			if (outcome.status === 'twoFactorRequired') {
				pendingTwoFactor = outcome.pending;
				twoFaError = null;
				twoFaFailures = 0;
				busy = false;
				return;
			}
			await navigateAfterLogin(outcome.result.slot);
		} catch (err) {
			console.error('login failed', err);
			if (err instanceof ApiCallError) {
				loginError =
					err.status === 401
						? m.auth_login_wrong_credentials()
						: m.auth_login_failed_http({ status: err.status });
			} else {
				loginError = err instanceof Error ? err.message : m.auth_login_failed();
			}
			busy = false;
		}
	}

	async function resetToPasswordStep(message: string | null) {
		await abandonTwoFactorLogin();
		pendingTwoFactor = null;
		twoFaError = null;
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
		try {
			const { slot } = await fn(pending);
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
			if (isWebauthnCancelled(err)) {
				twoFaBusy = false;
				return;
			}
			console.error('two-factor failed', err);
			twoFaError = err instanceof Error ? err.message : m.auth_login_2fa_failed();
			twoFaBusy = false;
		}
	}

	function ssoSubmit() {
		if (!ssoDomain || busy) return;
		busy = true;
		setTimeout(() => goto('/'), 1100);
	}
</script>

{#snippet addr(t: string)}<span class="mono" style="color:var(--ink-700)">{t}</span>{/snippet}
{#snippet registerLink(t: string)}<a href={registerHref}>{t}</a>{/snippet}

<svelte:head>
	<title>{m.auth_login_page_title()}</title>
</svelte:head>

{#if view === 'sso'}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">{m.auth_sso_eyebrow()}</p>
			<h1>{m.auth_sso_title()}</h1>
			<p>{m.auth_sso_lede()}</p>
		</div>
		<div class="form">
			<div class="field">
				<div class="lab"><label for="sso-domain">{m.auth_sso_domain_label()}</label></div>
				<div class="affix">
					<input
						id="sso-domain"
						bind:value={ssoDomain}
						oninput={(e) => (ssoDomain = e.currentTarget.value.toLowerCase())}
						placeholder="example.com"
						autocomplete="off"
						spellcheck="false"
						onkeydown={(e) => {
							if (e.key === 'Enter') ssoSubmit();
						}}
					/>
					<span class="statusic"><Globe size={17} strokeWidth={1.75} /></span>
				</div>
				<span class="hint">{m.auth_sso_domain_hint()}</span>
			</div>
			<div class="actions">
				<Button variant="primary" size="lg" block disabled={!ssoDomain || busy} onclick={ssoSubmit}>
					{#if busy}
						<span class="spinner"></span>{m.auth_sso_redirecting()}
					{:else}
						{m.auth_sso_continue()}<ArrowRight size={17} strokeWidth={1.75} />
					{/if}
				</Button>
				<Button variant="ghost" size="lg" block onclick={() => {
						view = 'main';
						busy = false;
					}}>
					<ArrowLeft size={17} strokeWidth={1.75} />{m.auth_2fa_back_to_sign_in()}
				</Button>
			</div>
		</div>
	</div>
{:else if pendingTwoFactor}
	<div class="card-surface screen-fade">
		<TwoFactorChallenge
			email={pendingTwoFactor.email}
			methods={pendingTwoFactor.methods}
			busy={twoFaBusy}
			error={twoFaError}
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
			{:else if targetSlot && slotAccountEmail()}
				<p class="eyebrow">{m.auth_login_resume_eyebrow()}</p>
				<h1>{m.auth_login_resume_title()}</h1>
				<p>{m.auth_login_resume_lede()}</p>
			{:else}
				<p class="eyebrow">{m.auth_login_eyebrow()}</p>
				<h1>{m.auth_login_title()}</h1>
			{/if}
		</div>
		<div class="form">
			<div class="field">
				<div class="lab"><label for="login-email">{m.common_email_address()}</label></div>
				<input
					id="login-email"
					class="inp"
					type="email"
					bind:value={email}
					placeholder="you@yourdomain.com"
					autocomplete="username"
					onkeydown={(e) => {
						if (e.key === 'Enter') submit();
					}}
				/>
			</div>
			<PasswordField
				label={m.common_password()}
				bind:value={pw}
				placeholder={m.auth_login_password_placeholder()}
				autocomplete="current-password"
				onEnter={submit}
			>
				{#snippet aux()}
					<a
						class="aux"
						href={emailValid ? `/recover?email=${encodeURIComponent(email)}` : '/recover'}
					>
						{m.auth_login_forgot_password()}
					</a>
				{/snippet}
			</PasswordField>
			{#if loginError}
				<span class="errtext" style="margin-top:-8px">
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
				<Button variant="primary" size="lg" block disabled={!canSignIn || busy} onclick={submit}>
					{#if busy}
						<span class="spinner"></span>{m.auth_login_signing_in()}
					{:else}
						{m.auth_sign_in()}
					{/if}
				</Button>
			</div>
		</div>
		<p class="switch">
			<Rich text={m.auth_login_new_to()} tags={{ link: registerLink }} />
		</p>
	</div>
{/if}
