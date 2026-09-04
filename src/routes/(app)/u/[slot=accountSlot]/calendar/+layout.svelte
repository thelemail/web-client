<script lang="ts">
	import '$lib/calendar/calendar.css';
	import * as Dialog from '$lib/components/ui/dialog';
	import Toast from '$lib/components/Toast.svelte';
	import MailCommitmentsDialog from '$lib/calendar/dialogs/MailCommitmentsDialog.svelte';
	import OfferTimesDialog from '$lib/calendar/dialogs/OfferTimesDialog.svelte';
	import SyncQueueDialog from '$lib/calendar/dialogs/SyncQueueDialog.svelte';
	import CalRail from '$lib/calendar/rail/CalRail.svelte';
	import SystemBar from '$lib/calendar/SystemBar.svelte';
	import TasksPane from '$lib/calendar/tasks/TasksPane.svelte';
	import TopBar from '$lib/calendar/TopBar.svelte';
	import { cal } from '$lib/calendar/state.svelte';

	let { children } = $props();
</script>

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
		{#if cal.offline}
			<SystemBar />
		{/if}
		<div class="cal-body">
			<div class="viewport">
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
		if (!open) cal.dialog = null;
	}}
>
	{#if cal.dialog === 'mail'}
		<MailCommitmentsDialog />
	{:else if cal.dialog === 'offer'}
		<OfferTimesDialog />
	{:else if cal.dialog === 'sync'}
		<SyncQueueDialog />
	{/if}
</Dialog.Root>

{#if cal.toast}
	<Toast text={cal.toast} shift={124} />
{/if}
