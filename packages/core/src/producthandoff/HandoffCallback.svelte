<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import AuthShell from '$core/auth/AuthShell.svelte';
	import HandoffCard from '$core/auth/form/HandoffCard.svelte';
	import { productHost } from '$core/products';
	import Rich from '$core/i18n/Rich.svelte';
	import { Button } from '$core/components/ui/button';
	import { localForkPath } from '$core/fork';
	import { auth } from '$core/stores/auth.svelte';
	import { accounts } from '$core/stores/accounts.svelte';
	import { m } from '$paraglide/messages.js';
	import { HandoffError } from './begin';
	import { completeHandoff, takeCallbackFragment } from './complete';
	import { handBack, inAuthTab, leaveAuthTab } from './tab';

	const CLOSE_AFTER = 3;

	const fragment = takeCallbackFragment();
	let error = $state<string | null>(null);
	let phase = $state<'working' | 'counting' | 'stayed'>('working');
	let left = $state(CLOSE_AFTER);
	let address = $state('');
	let ticker: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		void run();
	});

	onDestroy(stopTicker);

	function stopTicker() {
		if (ticker) clearInterval(ticker);
		ticker = null;
	}

	function closeTab() {
		stopTicker();
		window.close();
		setTimeout(() => {
			if (!window.closed) phase = 'stayed';
		}, 300);
	}

	function stay() {
		stopTicker();
		phase = 'stayed';
	}

	function countDown() {
		left = CLOSE_AFTER;
		phase = 'counting';
		ticker = setInterval(() => {
			left -= 1;
			if (left <= 0) closeTab();
		}, 1000);
	}

	async function run() {
		if (!fragment) {
			error = m.handoff_failed();
			return;
		}
		try {
			const done = await completeHandoff(fragment);
			if (inAuthTab()) {
				leaveAuthTab();
				await auth.loadProfile(done.accountId).catch(() => undefined);
				address = accounts.byId(done.accountId)?.email || auth.emailFor(done.accountId) || '';
				const path = localForkPath(done.route, done.slot);
				if (await handBack({ accountId: done.accountId, path, ...(address ? { email: address } : {}) })) {
					countDown();
					return;
				}
			}
			auth.activate(done.accountId);
			await goto(localForkPath(done.route, done.slot), { replace: true });
		} catch (err) {
			leaveAuthTab();
			error = err instanceof HandoffError && err.code === 'account' ? m.handoff_wrong_account() : m.handoff_failed();
		}
	}
</script>

{#snippet account(_: string)}<span class="mono">{address}</span>{/snippet}
{#snippet count(_: string)}<span class="tabnum">{left}</span>{/snippet}

<AuthShell strip={false}>
	<div class="card" aria-live="polite">
		{#if error}
			<div class="card-surface">
				<div class="card-head">
					<h1>{m.handoff_title()}</h1>
					<p>{error}</p>
				</div>
				<Button variant="primary" size="lg" block href="/">{m.handoff_restart()}</Button>
			</div>
		{:else if phase === 'counting'}
			<div class="card-surface">
				<div class="card-head">
					<h1>{m.handoff_tab_done_title()}</h1>
					<p><Rich text={address ? m.handoff_tab_done_sentence() : m.handoff_tab_done_plain()} tags={{ account, count }} /></p>
				</div>
				<div class="af-bar" aria-hidden="true"><i style:width="{((CLOSE_AFTER - left + 1) / CLOSE_AFTER) * 100}%"></i></div>
				<p class="af-fine center">{m.handoff_tab_closes()}</p>
				<Button variant="primary" size="lg" block onclick={closeTab}>{m.handoff_tab_go_now()}</Button>
				<p class="af-row"><button type="button" class="af-link muted" onclick={stay}>{m.handoff_tab_stay()}</button></p>
			</div>
		{:else if phase === 'stayed'}
			<div class="card-surface">
				<div class="card-head">
					<h1>{m.handoff_tab_done_title()}</h1>
					<p>{#if address}<Rich text={m.handoff_tab_stayed_sentence()} tags={{ account }} />{:else}{m.handoff_tab_stayed_plain()}{/if}</p>
				</div>
				<Button variant="neutral" size="lg" block onclick={closeTab}>{m.handoff_tab_close()}</Button>
			</div>
		{:else}
			<HandoffCard title={m.handoff_finish_title()} lede={m.handoff_finish_lede()} from={productHost('auth')} to={location.host} secure="from" />
		{/if}
	</div>
</AuthShell>

<style>
	.tabnum {
		font-variant-numeric: tabular-nums;
	}
</style>
