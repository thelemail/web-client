<script lang="ts">
	import '$core/calendar/calendar.css';
	import { onMount } from 'svelte';
	import * as Dialog from '$core/components/ui/dialog';
	import Toast from '$core/components/Toast.svelte';
	import ReadOnlyGuard from '$core/lifecycle/ReadOnlyGuard.svelte';
	import SyncQueueDialog from '$core/calendar/dialogs/SyncQueueDialog.svelte';
	import CalRail from '$core/calendar/rail/CalRail.svelte';
	import SystemBar from '$core/calendar/SystemBar.svelte';
	import TasksPane from '$core/calendar/tasks/TasksPane.svelte';
	import TopBar from '$core/calendar/TopBar.svelte';
	import { takePending } from '$core/calendar/entry';
	import { observeNewMessage } from '$core/calendar/entry';
	import { startReminders } from '$core/calendar/reminders';
	import { cal } from '$core/calendar/state.svelte';
	import { calendarStore } from '$core/calendar/store.svelte';
	import { ensureAccountData } from '$core/stores/accountData';
	import { auth } from '$core/stores/auth.svelte';
	import { calendarKeys } from '$core/stores/calendarKeys.svelte';

	let { children } = $props();

	$effect(() => {
		const accountId = auth.accountId;
		if (!accountId || !auth.canEnterApp) return;
		ensureAccountData(accountId);
		calendarStore.setAccount(accountId);
		void calendarKeys
			.ready(accountId)
			.then(() => calendarStore.ensureLoaded())
			.then(() => {
				const pending = takePending();
				if (pending) {
					cal.openEditor({
						mode: 'create',
						kind: pending.kind,
						prefill: {
							title: pending.title,
							notes: pending.notes,
							sourceMessageId: pending.sourceMessageId,
							threadSubject: pending.threadSubject
						}
					});
				}
			});
	});

	onMount(() => {
		const stopClock = cal.startClock();
		const stopReminders = startReminders((notice) => cal.notify(`${notice.title} · ${notice.body}`));
		const stopMessages = calendarStore.onMessage((hint) => {
			if (hint.id) void observeNewMessage(hint.id).catch(() => {});
		});
		return () => {
			stopClock();
			stopReminders();
			stopMessages();
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
			cal.history = null;
		}
	}}
>
	{#if cal.dialog === 'mail' && import.meta.env.DEV}
		{#await import('$core/calendar/preview/dialogs/MailCommitmentsDialog.svelte') then mod}
			<mod.default />
		{/await}
	{:else if cal.dialog === 'offer' && import.meta.env.DEV}
		{#await import('$core/calendar/preview/dialogs/OfferTimesDialog.svelte') then mod}
			<mod.default />
		{/await}
	{:else if cal.dialog === 'sync'}
		<SyncQueueDialog />
	{:else if cal.dialog === 'editor' && cal.editor}
		{#await import('$core/calendar/dialogs/ItemEditorDialog.svelte') then mod}
			<mod.default request={cal.editor} />
		{/await}
	{:else if cal.dialog === 'calendar' && cal.calendarDialog}
		{#await import('$core/calendar/dialogs/CalendarDialog.svelte') then mod}
			<mod.default request={cal.calendarDialog} />
		{/await}
	{:else if cal.dialog === 'history' && cal.history}
		{#await import('$core/calendar/dialogs/HistoryDialog.svelte') then mod}
			<mod.default request={cal.history} />
		{/await}
	{:else if cal.dialog === 'scope' && cal.scope}
		{#await import('$core/calendar/dialogs/RecurrenceScopeDialog.svelte') then mod}
			<mod.default request={cal.scope} />
		{/await}
	{/if}
</Dialog.Root>

<ReadOnlyGuard />

{#if cal.toast}
	<Toast text={cal.toast} shift={124} />
{/if}
