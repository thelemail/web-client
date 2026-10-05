<script lang="ts">
	import { m } from '$paraglide/messages.js';
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

	const NARROW = '(max-width: 1000px)';
	let narrow = $state(false);
	$effect(() => {
		const mq = window.matchMedia(NARROW);
		const sync = () => (narrow = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	const drawer = $derived(narrow && mailNav.open);

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented || !drawer) return;
		e.preventDefault();
		mailNav.close(true);
	}

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

<svelte:window onkeydown={onKeydown} />

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
		<button class="rail-scrim" aria-label={m.mail_close_menu()} onclick={() => mailNav.close(true)}
		></button>
	{/if}
	<Sidebar
		counts={{
			inbox: mailbox.counts.inbox,
			starred: mailbox.counts.starred,
			spam: mailbox.counts.spam,
			snoozed: mailbox.counts.snoozed,
			drafts: drafts.count,
			scheduled: scheduled.count
		}}
		folderCounts={mailbox.counts.folders}
		labelCounts={mailbox.counts.labels}
		onCompose={() => {
			composeStore.openNew();
			mailNav.close();
		}}
	/>
	<div class="mailmain" inert={drawer}>{@render children()}</div>
</div>

<ReadOnlyGuard />
