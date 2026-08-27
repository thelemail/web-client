<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PasswordField from '$lib/auth/PasswordField.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Globe from '@lucide/svelte/icons/globe';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Check from '@lucide/svelte/icons/check';
	import { ApiCallError } from '$lib/api/types';
	import {
		abandonTwoFactorLogin,
		performLogin,
		submitTwoFactorBackupCode,
		submitTwoFactorTotp,
		submitTwoFactorWebauthn,
		TwoFactorExpiredError,
		TwoFactorRejectedError,
		type PendingTwoFactorLogin
	} from '$lib/auth/perform-login';
	import TwoFactorChallenge from '$lib/auth/TwoFactorChallenge.svelte';
	import { isWebauthnCancelled } from '$lib/auth/webauthn';
	import { auth } from '$lib/stores/auth.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';

	const addMode = $derived(page.url.searchParams.get('addAccount') === '1');
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
		const redirectTo = page.url.searchParams.get('redirect');
		if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
			await goto(redirectTo);
		} else {
			await goto(`/u/${slot}/mail/inbox`);
		}
	}

	async function submit() {
		if (!canSignIn || busy) return;
		busy = true;
		loginError = null;
		const password = pw;
		try {
			pw = '';
			const outcome = await performLogin({ email, password, rememberMe });
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
						? 'Wrong email or password.'
						: `Sign-in failed (HTTP ${err.status}). Please try again.`;
			} else {
				loginError = err instanceof Error ? err.message : 'Authentication failed';
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
			await resetToPasswordStep('Your sign-in expired — enter your password again.');
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
					await resetToPasswordStep('Your sign-in expired — enter your password again.');
					return;
				}
				twoFaError = 'That code didn’t work. Try again.';
				twoFaBusy = false;
				return;
			}
			if (err instanceof TwoFactorExpiredError) {
				await resetToPasswordStep('Your sign-in expired — enter your password again.');
				return;
			}
			if (isWebauthnCancelled(err)) {
				twoFaBusy = false;
				return;
			}
			console.error('two-factor failed', err);
			twoFaError = err instanceof Error ? err.message : 'Verification failed';
			twoFaBusy = false;
		}
	}

	function ssoSubmit() {
		if (!ssoDomain || busy) return;
		busy = true;
		setTimeout(() => goto('/'), 1100);
	}
</script>

<svelte:head>
	<title>Thelemail — Sign in</title>
</svelte:head>

{#if view === 'sso'}
	<div class="card-surface screen-fade">
		<div class="card-head">
			<p class="eyebrow">Single sign-on</p>
			<h1>Sign in with SSO</h1>
			<p>
				Enter the domain your organization uses with Thelemail. We&rsquo;ll route you to your
				identity provider.
			</p>
		</div>
		<div class="form">
			<div class="field">
				<div class="lab"><label for="sso-domain">Organization domain</label></div>
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
				<span class="hint">For example, the domain on your work address.</span>
			</div>
			<div class="actions">
				<button
					class="btn btn-primary btn-block"
					disabled={!ssoDomain || busy}
					onclick={ssoSubmit}
				>
					{#if busy}
						<span class="spinner"></span>Redirecting&hellip;
					{:else}
						Continue with SSO<ArrowRight size={17} strokeWidth={1.75} />
					{/if}
				</button>
				<button
					class="btn btn-ghost btn-block"
					onclick={() => {
						view = 'main';
						busy = false;
					}}
				>
					<ArrowLeft size={17} strokeWidth={1.75} />Back to sign in
				</button>
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
				Password accepted. <span class="mono" style="color:var(--ink-700)"
					>{pendingTwoFactor?.email}</span
				> also asks for a second factor.
			{/snippet}
		</TwoFactorChallenge>
	</div>
{:else}
	<div class="card-surface screen-fade">
		<div class="card-head">
			{#if addMode}
				<p class="eyebrow">Add another account</p>
				<h1>Sign in to a second account</h1>
				<p>You can be signed in to several Thelemail accounts at once on this device.</p>
			{:else if targetSlot && slotAccountEmail()}
				<p class="eyebrow">Continue session</p>
				<h1>Sign back in</h1>
				<p>Re-enter your password to unlock this account on this device.</p>
			{:else}
				<p class="eyebrow">Welcome back</p>
				<h1>Sign in to Thelemail</h1>
			{/if}
		</div>
		<div class="form">
			<div class="field">
				<div class="lab"><label for="login-email">Email address</label></div>
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
				label="Password"
				bind:value={pw}
				placeholder="Your password"
				autocomplete="current-password"
				onEnter={submit}
			>
				{#snippet aux()}
					<a
						class="aux"
						href={emailValid ? `/recover?email=${encodeURIComponent(email)}` : '/recover'}
					>
						Forgot password?
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
				Remember me on this device
			</label>
			<div class="actions">
				<button class="btn btn-primary btn-block" disabled={!canSignIn || busy} onclick={submit}>
					{#if busy}
						<span class="spinner"></span>Signing in&hellip;
					{:else}
						Sign in
					{/if}
				</button>
			</div>
		</div>
		<p class="switch">
			New to Thelemail? <a href="/register">Create an account</a>
		</p>
	</div>
{/if}
