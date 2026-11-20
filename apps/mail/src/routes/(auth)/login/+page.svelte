<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import LoginFlow from '$core/auth/LoginFlow.svelte';
	import { resolveReturnTo } from '$core/auth/return-to';
	import { Button } from '$core/components/ui/button';
	import { mailOnlyAccountId, signInAtAuth, signInMovedToAuth, unlockAtAuth } from '$core/custody/unlock';
	import { keystore } from '$core/keystore/keystore-client';
	import { authTabPendingFor, awaitAuthTab, openAuthTab, type TabResult } from '$core/producthandoff/tab';
	import { accountTransition } from '$core/stores/accountTransition.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import { auth } from '$core/stores/session.svelte';
	import { delayed } from '$core/async/delayed.svelte';
	import { m } from '$paraglide/messages.js';

	const slot = page.url.searchParams.get('slot');
	let mode = $state<'checking' | 'password' | 'auth' | 'failed' | 'tab'>('checking');
	let tabFor = $state<string | null>(null);
	let tabOpen = $state(false);
	let backTo = $state<string | null>(null);
	let stopWaiting: (() => void) | null = null;
	const checking = delayed(() => mode === 'checking', { minVisible: 0 });

	function redirect(): string | null {
		return page.url.searchParams.get('redirect');
	}

	async function unlockedBesides(accountId: string | null): Promise<string | null> {
		let status: Awaited<ReturnType<typeof keystore.status>> | null = null;
		try {
			status = await keystore.status();
		} catch {
			return null;
		}
		const other = status.accounts.find((a) => a.unlocked && a.accountId !== accountId);
		const slot = other ? accounts.byId(other.accountId)?.slot : undefined;
		return slot === undefined ? null : `/u/${slot}/mail/inbox`;
	}

	async function arrived(result: TabResult): Promise<void> {
		stopWaiting?.();
		stopWaiting = null;
		await accounts.refresh();
		const email = accounts.byId(result.accountId)?.email ?? null;
		await accountTransition.run('switch', email, async () => {
			await goto(result.path, { replace: true });
		});
	}

	function waitForTab(accountId: string | null): void {
		stopWaiting?.();
		stopWaiting = awaitAuthTab(accountId, (result) => void arrived(result));
	}

	function openTab(): void {
		tabOpen = openAuthTab(tabFor, redirect() ?? '/');
	}

	function continueHere(): void {
		stopWaiting?.();
		stopWaiting = null;
		void open(tabFor);
	}

	async function open(accountId: string | null): Promise<void> {
		if (mode !== 'tab') {
			const back = await unlockedBesides(accountId);
			if (back) {
				tabFor = accountId;
				backTo = back;
				tabOpen = authTabPendingFor(accountId);
				waitForTab(accountId);
				mode = 'tab';
				return;
			}
		}
		mode = 'auth';
		try {
			await (accountId ? unlockAtAuth(accountId, redirect()) : signInAtAuth(redirect()));
		} catch {
			mode = 'failed';
		}
	}

	async function signedIn(signedSlot: number): Promise<void> {
		const accountId = accounts.bySlot(signedSlot)?.accountId;
		if (accountId) {
			await auth.loadProfile(accountId).catch(() => undefined);
			if (auth.mailOnlyFor(accountId) && auth.authOriginEnrolledFor(accountId)) {
				await keystore.lock({ accountId }).catch(() => undefined);
				await open(accountId);
				return;
			}
		}
		await goto(resolveReturnTo(redirect(), signedSlot));
	}

	async function decide(): Promise<void> {
		const accountId = slot === null ? null : await mailOnlyAccountId({ slot: Number(slot) }).catch(() => null);
		if (accountId) return open(accountId);
		if (await signInMovedToAuth()) return open(slot === null ? null : (accounts.bySlot(Number(slot))?.accountId ?? null));
		mode = 'password';
	}

	async function intercept(identifier: string): Promise<boolean> {
		const accountId = await mailOnlyAccountId({ identifier });
		if (!accountId) return false;
		void open(accountId);
		return true;
	}

	onMount(() => {
		void decide();
	});

	onDestroy(() => stopWaiting?.());
</script>

{#if mode === 'password'}
	<LoginFlow {intercept} afterSignIn={signedIn} />
{:else if mode === 'tab'}
	<div class="unlockcard" aria-live="polite">
		<h1>{m.handoff_tab_title()}</h1>
		<p class="unlockmsg">{tabOpen ? m.handoff_tab_waiting() : m.handoff_tab_ask()}</p>
		<Button variant="primary" size="lg" onclick={openTab}>{tabOpen ? m.handoff_tab_reopen() : m.handoff_tab_open()}</Button>
		<div class="unlockalt">
			<Button variant="ghost" size="sm" onclick={continueHere}>{m.handoff_tab_here()}</Button>
			{#if backTo}
				<Button variant="ghost" size="sm" href={backTo}>{m.handoff_tab_back()}</Button>
			{/if}
		</div>
	</div>
{:else if mode === 'checking'}
	<div class="unlockcard" aria-busy="true" aria-live="polite">
		{#if checking.visible}
			<p class="unlockmsg">{m.common_loading()}</p>
		{/if}
	</div>
{:else}
	<div class="unlockcard" aria-live="polite">
		{#if mode === 'failed'}
			<h1>{m.handoff_title()}</h1>
			<p class="unlockmsg">{m.handoff_failed()}</p>
			<Button variant="primary" size="lg" href={page.url.pathname + page.url.search}>{m.handoff_restart()}</Button>
		{:else}
			<p class="unlockmsg">{m.handoff_opening()}</p>
		{/if}
	</div>
{/if}

<style>
	.unlockcard {
		display: grid;
		gap: 0.75rem;
		justify-items: start;
	}
	.unlockmsg {
		color: var(--muted-foreground);
	}
	.unlockalt {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
