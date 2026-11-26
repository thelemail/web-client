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
	import Status from '$core/auth/form/Status.svelte';
	import Rich from '$core/i18n/Rich.svelte';
	import { m } from '$paraglide/messages.js';

	const slot = page.url.searchParams.get('slot');
	let mode = $state<'checking' | 'password' | 'auth' | 'failed' | 'tab'>('checking');
	let tabFor = $state<string | null>(null);
	let tabOpen = $state(false);
	let backTo = $state<string | null>(null);
	let stopWaiting: (() => void) | null = null;
	const checking = delayed(() => mode === 'checking', { minVisible: 0 });
	const tabEmail = $derived(tabFor ? (accounts.byId(tabFor)?.email ?? null) : null);

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
		const email = accounts.byId(result.accountId)?.email || result.email || null;
		await accountTransition.run('switch', email, async () => {
			await goto(result.path, { replace: true });
		});
		if (email) accountTransition.announceArrival(email);
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
	{#snippet account(_: string)}<span class="mono">{tabEmail}</span>{/snippet}
	<div class="card-surface" aria-live="polite">
		<div class="card-head">
			<h1>{tabOpen ? m.handoff_tab_waiting_title() : m.handoff_tab_ask_title()}</h1>
			<p>
				{#if tabEmail}
					<Rich text={tabOpen ? m.handoff_tab_waiting_sentence() : m.handoff_tab_ask_sentence()} tags={{ account }} />
				{:else}
					{tabOpen ? m.handoff_tab_waiting_new() : m.handoff_tab_ask_new()}
				{/if}
			</p>
		</div>
		{#if tabOpen}<Status tone="busy">{m.handoff_tab_waiting_line()}</Status>{/if}
		<Button variant="primary" size="lg" block onclick={openTab}>{tabOpen ? m.handoff_tab_reopen() : m.handoff_tab_open()}</Button>
		<p class="af-row">
			<button type="button" class="af-link" onclick={continueHere}>{m.handoff_tab_here()}</button>
			{#if backTo}
				<span aria-hidden="true">·</span>
				<a class="af-link muted" href={backTo}>{m.handoff_tab_back()}</a>
			{/if}
		</p>
	</div>
{:else if mode === 'checking'}
	<div class="af-wait" aria-busy="true">
		<Status tone={checking.visible ? 'busy' : 'hint'}>{checking.visible ? m.common_loading() : ''}</Status>
	</div>
{:else if mode === 'failed'}
	<div class="card-surface">
		<div class="card-head">
			<h1>{m.handoff_title()}</h1>
			<p>{m.handoff_failed()}</p>
		</div>
		<Button variant="primary" size="lg" block href={page.url.pathname + page.url.search}>{m.handoff_restart()}</Button>
	</div>
{:else}
	<div class="af-wait" aria-busy="true">
		<Status tone="busy">{m.handoff_opening()}</Status>
	</div>
{/if}
