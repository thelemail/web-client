<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import ReauthDialog from '$core/auth/ReauthDialog.svelte';
	import { ApiCallError } from '$core/api/types';
	import { ensureConverted } from '$core/auth/product-keys';
	import { syncAddressUids } from '$core/keys/uid-sync';
	import { accounts } from '$core/stores/accounts.svelte';
	import { auth } from '$core/stores/session.svelte';
	import {
		clearPendingAuthorize,
		grantRequest,
		locateRequest,
		takeAuthorizeFragment
	} from '$core/producthandoff/authorize';
	import { m } from '$paraglide/messages.js';

	const LOGIN_TRIED = 'thelemail-authorize-login';
	const UID_SYNC_WAIT_MS = 4000;
	const fragment = takeAuthorizeFragment();
	let error = $state<string | null>(null);

	onMount(() => {
		void run();
	});

	async function ready(accountId: string): Promise<boolean> {
		return (await auth.tryRefresh(accountId)) && (await auth.ensureVaultUnlocked(accountId));
	}

	function fail(message: string) {
		clearPendingAuthorize();
		sessionStorage.removeItem(LOGIN_TRIED);
		error = message;
	}

	async function signIn(slot: number | null) {
		if (sessionStorage.getItem(LOGIN_TRIED)) {
			fail(m.handoff_auth_other_account());
			return;
		}
		sessionStorage.setItem(LOGIN_TRIED, '1');
		await goto(slot === null ? '/login' : `/login?slot=${slot}`);
	}

	async function run() {
		if (!fragment) {
			fail(m.handoff_auth_invalid());
			return;
		}
		try {
			const req = await locateRequest(fragment);
			const expected = req.descriptor.expectedAccountId;
			const rec = expected ? accounts.byId(expected) : auth.accountId ? accounts.byId(auth.accountId) : null;
			if (!rec || !(await ready(rec.accountId))) {
				await signIn(rec?.slot ?? null);
				return;
			}
			auth.activate(rec.accountId);
			if (!(await ensureConverted(rec.accountId))) {
				fail(m.handoff_auth_invalid());
				return;
			}
			await Promise.race([syncAddressUids(rec.accountId), new Promise((resolve) => setTimeout(resolve, UID_SYNC_WAIT_MS))]);
			const callback = await grantRequest(rec.accountId, req);
			clearPendingAuthorize();
			sessionStorage.removeItem(LOGIN_TRIED);
			window.location.replace(callback);
		} catch (err) {
			const code = err instanceof ApiCallError ? err.envelope?.error?.code : undefined;
			fail(code === 'handoff_account_mismatch' ? m.handoff_auth_other_account() : m.handoff_auth_invalid());
		}
	}
</script>

<AuthShell>
	<div class="card handoffcard" aria-live="polite">
		{#if error}
			<h1>{m.handoff_title()}</h1>
			<p class="handoffmsg">{error}</p>
		{:else}
			<p class="handoffmsg">{m.handoff_auth_returning()}</p>
		{/if}
	</div>
</AuthShell>

<ReauthDialog />

<style>
	.handoffcard {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}
	.handoffmsg {
		color: var(--muted-foreground);
	}
</style>
