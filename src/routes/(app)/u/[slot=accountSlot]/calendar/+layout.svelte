<script lang="ts">
	import '$lib/calendar/calendar.css';
	import { dev } from '$app/environment';
	import { onMount } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import Toast from '$lib/components/Toast.svelte';
	import ReadOnlyGuard from '$lib/lifecycle/ReadOnlyGuard.svelte';
	import SyncQueueDialog from '$lib/calendar/dialogs/SyncQueueDialog.svelte';
	import CalRail from '$lib/calendar/rail/CalRail.svelte';
	import SystemBar from '$lib/calendar/SystemBar.svelte';
	import TasksPane from '$lib/calendar/tasks/TasksPane.svelte';
	import TopBar from '$lib/calendar/TopBar.svelte';
	import { cal } from '$lib/calendar/state.svelte';
	import { calendarStore } from '$lib/calendar/store.svelte';
	import { ensureAccountData } from '$lib/stores/accountData';
	import { auth } from '$lib/stores/auth.svelte';
	import { calendarKeys } from '$lib/stores/calendarKeys.svelte';

	let { children } = $props();

	$effect(() => {
		const accountId = auth.accountId;
		if (!accountId || !auth.canEnterApp) return;
		ensureAccountData(accountId);
		calendarStore.setAccount(accountId);
		void calendarKeys.ready(accountId).then(() => calendarStore.ensureLoaded());
	});

	onMount(() => {
		const stopClock = cal.startClock();
		return () => {
			stopClock();
			calendarStore.stop();
		};
	});

	function onKey(ev: KeyboardEvent) {
		if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
		const target = ev.target as HTMLElement | null;
		if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return;
		if (cal.dialog) return;
		switch (ev.key) {
			case 'e':
				cal.openEditor({ mode: 'create', kind: 'event' });
				break;
			case 't':
				cal.openEditor({ mode: 'create', kind: 'task' });
				break;
			case 'h':
				cal.openEditor({ mode: 'create', kind: 'hold' });
				break;
			case 'w':
				cal.goTo('week');
				break;
			case 'm':
				cal.goTo('month');
				break;
			case 'a':
				cal.goTo('agenda');
				break;
			case 'j':
				cal.next();
				break;
			case 'k':
				cal.prev();
				break;
			default:
				return;
		}
		ev.preventDefault();
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="cal-app" class:nav-open={cal.navOpen}>
	{#if cal.navOpen}
		<button
			type="button"
			class="rail-scrim"
			aria-label="Close menu"
			onclick={() => (cal.navOpen = false)}
		></button>
	{/if}

	<CalRail />

	<div class="main">
		<TopBar />
		{#if calendarStore.showSystemBar}
			<SystemBar />
		{/if}
		<div class="cal-body">
			<div class="viewport">
				{#if calendarStore.loadError && !calendarStore.calendars.length}
					<div class="cal-notice">{calendarStore.loadError}</div>
				{/if}
				{@render children()}
			</div>
			{#if cal.tasksOpen}
				<TasksPane />
			{/if}
		</div>
	</div>
</div>

<Dialog.Root
	open={cal.dialog !== null}
	onOpenChange={(open) => {
		if (!open) {
			cal.dialog = null;
			cal.editor = null;
			cal.calendarDialog = null;
			cal.scope = null;
		}
	}}
>
	{#if cal.dialog === 'mail' && dev}
		{#await import('$lib/calendar/preview/dialogs/MailCommitmentsDialog.svelte') then mod}
			<mod.default />
		{/await}
	{:else if cal.dialog === 'offer' && dev}
		{#await import('$lib/calendar/preview/dialogs/OfferTimesDialog.svelte') then mod}
			<mod.default />
		{/await}
	{:else if cal.dialog === 'sync'}
		<SyncQueueDialog />
	{:else if cal.dialog === 'editor' && cal.editor}
		{#await import('$lib/calendar/dialogs/ItemEditorDialog.svelte') then mod}
			<mod.default request={cal.editor} />
		{/await}
	{:else if cal.dialog === 'calendar' && cal.calendarDialog}
		{#await import('$lib/calendar/dialogs/CalendarDialog.svelte') then mod}
			<mod.default request={cal.calendarDialog} />
		{/await}
	{:else if cal.dialog === 'scope' && cal.scope}
		{#await import('$lib/calendar/dialogs/RecurrenceScopeDialog.svelte') then mod}
			<mod.default request={cal.scope} />
		{/await}
	{/if}
</Dialog.Root>

<ReadOnlyGuard />

{#if cal.toast}
	<Toast text={cal.toast} shift={124} />
{/if}
