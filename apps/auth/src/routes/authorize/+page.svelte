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
		authorizeHint,
		authorizeIntent,
		clearPendingAuthorize,
		grantRequest,
		locateRequest,
		loginTried,
		markLoginTried,
		takeAuthorizeFragment
	} from '$core/producthandoff/authorize';
	import { slotsOf, withSlots } from '$core/producthandoff/slots';
	import { m } from '$paraglide/messages.js';

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
		error = message;
	}

	async function signIn(requestId: string, slot: number | null) {
		if (loginTried(requestId)) {
			fail(m.handoff_auth_other_account());
			return;
		}
		markLoginTried(requestId);
		const hint = authorizeHint(fragment);
		if (authorizeIntent(fragment) === 'register' && slot === null) await goto('/register');
		else if (slot !== null) await goto(`/login?slot=${slot}`);
		else if (hint) await goto(`/login?${new URLSearchParams({ hint }).toString()}`);
		else await goto('/login');
	}

	async function run() {
		if (!fragment) {
			fail(m.handoff_auth_invalid());
			return;
		}
		try {
			const req = await locateRequest(fragment);
			const expected = req.descriptor.expectedAccountId;
			const chosen = loginTried(req.requestId) && auth.accountId ? accounts.byId(auth.accountId) : null;
			const rec = expected ? accounts.byId(expected) : chosen;
			if (!rec || !(await ready(rec.accountId))) {
				await signIn(req.requestId, rec?.slot ?? null);
				return;
			}
			auth.activate(rec.accountId);
			await auth.loadProfile(rec.accountId);
			if (auth.deletionFor(rec.accountId)) {
				await goto(`/u/${rec.slot}/deletion-pending`);
				return;
			}
			if (!(await ensureConverted(rec.accountId))) {
				fail(m.handoff_auth_unavailable());
				return;
			}
			await Promise.race([syncAddressUids(rec.accountId), new Promise((resolve) => setTimeout(resolve, UID_SYNC_WAIT_MS))]);
			const callback = await grantRequest(rec.accountId, req);
			clearPendingAuthorize();
			window.location.replace(withSlots(callback, rec.slot, slotsOf(accounts.list)));
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
