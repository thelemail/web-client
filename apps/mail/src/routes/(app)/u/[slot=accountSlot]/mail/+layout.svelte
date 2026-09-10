<script lang="ts">
	import './mail.css';
	import Sidebar from '$core/mail/Sidebar.svelte';
	import { mailbox } from '$core/stores/mailbox.svelte';
	import { drafts } from '$core/stores/drafts.svelte';
	import { scheduled } from '$core/stores/scheduled.svelte';
	import { composeStore } from '$core/stores/compose.svelte';
	import { mailNav } from '$core/stores/nav.svelte';
	import { preferences } from '$core/stores/preferences.svelte';
	import { auth } from '$core/stores/auth.svelte';
	import { ensureAccountData } from '$core/stores/accountData';
	import { DEFAULT_QUERY } from '$core/mail/url';
	import '$core/lifecycle/lifecycle.css';
	import { lifecycle } from '$core/lifecycle/lifecycle.svelte';
	import ReadOnlyGuard from '$core/lifecycle/ReadOnlyGuard.svelte';

	let { children, data } = $props();

	let loadedFor: string | null = null;
	$effect(() => {
		const accountId = data.accountId;
		const ready = auth.canEnterApp;
		if (!accountId || !ready || loadedFor === accountId) return;
		loadedFor = accountId;
		void mailbox.ensureLoaded({ ...DEFAULT_QUERY, folder: 'inbox' });
		void mailbox.refreshCounts();
		void drafts.ensureLoaded();
		void scheduled.ensureLoaded();
		ensureAccountData(accountId);
	});
</script>

<div
	class="mail-app"
	class:nav-open={mailNav.open}
	class:lc-ro={lifecycle.readOnly}
	data-accent={preferences.accent}
	data-density={preferences.density}
	data-contrast={preferences.highContrast ? 'high' : 'normal'}
	data-motion={preferences.reduceMotion ? 'reduced' : 'full'}
>
	{#if mailNav.open}
		<button class="rail-scrim" aria-label="Close menu" onclick={() => (mailNav.open = false)}
		></button>
	{/if}
	<Sidebar
		counts={{ ...mailbox.counts, drafts: drafts.count, scheduled: scheduled.count }}
		onCompose={() => {
			composeStore.openNew();
			mailNav.open = false;
		}}
	/>
	<div class="mailmain">{@render children()}</div>
</div>

<ReadOnlyGuard />
