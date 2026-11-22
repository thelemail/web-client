<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { getAssertion, webauthnFailure, webauthnFailureMessage, webauthnSupported } from '$core/auth/webauthn';
	import { Button } from '$core/components/ui/button';
	import { m } from '$paraglide/messages.js';

	type Request = { port: number; state: string; account: string; options: unknown };
	type Outcome = 'ok' | 'failed' | 'cancelled';

	const STATE = /^[A-Za-z0-9_-]{43}$/;
	const PORT = /^[1-9][0-9]{0,4}$/;
	const ACCOUNT = /^[^\s@]{1,64}@[^\s@]{1,253}$/;
	const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

	async function confirmationCode(state: string): Promise<string> {
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`thelemail-migrator-passkey:${state}`)));
		let bits = 0;
		let value = 0;
		let code = '';
		for (const byte of digest.subarray(0, 5)) {
			value = (value << 8) | byte;
			bits += 8;
			while (bits >= 5) {
				code += BASE32[(value >> (bits - 5)) & 31];
				bits -= 5;
			}
		}
		return `${code.slice(0, 4)}-${code.slice(4)}`;
	}
	const OUTCOMES: readonly Outcome[] = ['ok', 'failed', 'cancelled'];

	function fromBase64Url(value: string): string {
		const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
		const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
		return new TextDecoder().decode(bytes);
	}

	function toBase64Url(value: string): string {
		let binary = '';
		for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
		return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}

	function readRequest(params: URLSearchParams): Request | null {
		const port = params.get('port') ?? '';
		const state = params.get('state') ?? '';
		const options = params.get('options') ?? '';
		const account = params.get('account') ?? '';
		if (!PORT.test(port) || Number(port) > 65535 || !STATE.test(state) || !ACCOUNT.test(account) || !options) return null;
		try {
			const parsed: unknown = JSON.parse(fromBase64Url(options));
			if (!parsed || typeof parsed !== 'object') return null;
			return { port: Number(port), state, account, options: parsed };
		} catch {
			return null;
		}
	}

	const params = new URLSearchParams(page.url.hash.slice(1));
	const done = params.get('done') as Outcome | null;
	const outcome: Outcome | null = done && OUTCOMES.includes(done) ? done : null;
	const request = outcome ? null : readRequest(params);
	const supported = webauthnSupported();

	let working = $state(false);
	let leaving = $state(false);
	let problem = $state('');
	let code = $state('');

	onMount(() => {
		if (page.url.hash) replaceState(page.url.pathname, {});
		if (request) {
			confirmationCode(request.state).then(
				(value) => (code = value),
				() => (problem = webauthnFailureMessage('notAllowed'))
			);
		}
	});

	function handBack(r: Request, values: Record<string, string>) {
		const target = new URL('/migrator/passkey/result', `http://127.0.0.1:${r.port}`);
		target.searchParams.set('state', r.state);
		for (const [key, value] of Object.entries(values)) target.searchParams.set(key, value);
		leaving = true;
		window.location.replace(target.href);
	}

	async function verify() {
		if (!request || !code || working || leaving) return;
		working = true;
		problem = '';
		try {
			const assertion = await getAssertion(request.options);
			handBack(request, { credential: toBase64Url(JSON.stringify(assertion)) });
		} catch (err) {
			const failure = webauthnFailure(err);
			problem = failure && failure !== 'aborted' ? webauthnFailureMessage(failure) : webauthnFailureMessage('notAllowed');
		} finally {
			working = false;
		}
	}

	function cancel() {
		if (request && !leaving) handBack(request, { cancel: '1' });
	}

	const terminal = $derived.by(() => {
		switch (outcome) {
			case 'ok':
				return { title: m.auth_migrator_passkey_done_title(), body: m.auth_migrator_passkey_done_body() };
			case 'failed':
				return { title: m.auth_migrator_passkey_failed_title(), body: m.auth_migrator_passkey_failed_body() };
			case 'cancelled':
				return { title: m.auth_migrator_passkey_cancelled_title(), body: m.auth_migrator_passkey_cancelled_body() };
			default:
				return null;
		}
	});
</script>

<svelte:head>
	<title>{m.auth_migrator_passkey_page_title()}</title>
</svelte:head>

<div class="card-surface screen-fade">
	<div class="card-head">
		<p class="eyebrow">{m.auth_migrator_passkey_eyebrow()}</p>
		{#if terminal}
			<h1>{terminal.title}</h1>
			<p>{terminal.body}</p>
		{:else if !request}
			<h1>{m.auth_migrator_passkey_invalid_title()}</h1>
			<p>{m.auth_migrator_passkey_invalid_body()}</p>
		{:else}
			<h1>{m.auth_migrator_passkey_title()}</h1>
			<p>{supported ? m.auth_migrator_passkey_body() : m.auth_migrator_passkey_unsupported()}</p>
		{/if}
	</div>
	{#if request && !terminal && supported}
		<div style="margin-top:20px">
			<p>{m.auth_migrator_passkey_account({ account: request.account })}</p>
			<p>{m.auth_migrator_passkey_code_hint()}</p>
			<p class="migrator-code" aria-live="polite">{code}</p>
		</div>
	{/if}
	{#if request && !terminal}
		{#if problem}
			<p class="form-error" role="alert" style="margin-top:16px">{problem}</p>
		{/if}
		<div class="actions" style="margin-top:24px">
			{#if supported}
				<Button variant="primary" size="lg" block disabled={!code || working || leaving} aria-busy={working} onclick={verify}>
					{working ? m.auth_migrator_passkey_working() : problem ? m.common_retry() : m.auth_migrator_passkey_button()}
				</Button>
			{/if}
			<Button variant="ghost" size="lg" block disabled={leaving} onclick={cancel}>
				{m.auth_migrator_passkey_cancel()}
			</Button>
		</div>
	{/if}
</div>

<style>
	.migrator-code {
		font-size: 1.75rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		font-variant-numeric: tabular-nums;
	}
</style>
