<script lang="ts">
	import '$lib/calendar/calendar.css';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import CalSidebar from '$lib/calendar/CalSidebar.svelte';
	import CalTopBar from '$lib/calendar/CalTopBar.svelte';
	import EventPopover from '$lib/calendar/EventPopover.svelte';
	import QuickCreate from '$lib/calendar/QuickCreate.svelte';
	import EventDialog from '$lib/calendar/EventDialog.svelte';
	import { cal } from '$lib/calendar/state.svelte';

	let { children } = $props();
</script>

<div class="cal-app" class:nav-open={cal.navOpen}>
	{#if cal.navOpen}
		<button class="rail-scrim" aria-label="Close menu" onclick={() => (cal.navOpen = false)}></button>
	{/if}

	<CalSidebar />

	<div class="main">
		<CalTopBar />
		<div class="cal-body">
			<div class="viewport">
				{@render children()}
			</div>
		</div>
	</div>

	{#if cal.overlay}
		{@const ov = cal.overlay}
		{#if ov.type === 'popover'}
			{@const ev = ov.ev}
			<EventPopover
				{ev}
				anchorRect={ov.rect}
				rsvp={cal.rsvp[ev.id]}
				onRsvp={(r) => cal.setRsvp(ev.id, r)}
				onClose={cal.closeOverlay}
				onEdit={cal.editFromPopover}
				onDelete={() => cal.deleteEvent(ev.id)}
			/>
		{:else if ov.type === 'quick'}
			<QuickCreate
				draft={ov.draft}
				anchorRect={ov.rect}
				onChange={cal.patchDraft}
				onSave={() => cal.saveEvent(ov.draft)}
				onMore={cal.quickToDialog}
				onClose={cal.closeOverlay}
			/>
		{:else if ov.type === 'dialog'}
			<EventDialog
				initial={ov.initial}
				isEdit={ov.isEdit}
				onSave={cal.saveEvent}
				onDelete={() => cal.deleteEvent(ov.initial._id)}
				onClose={cal.closeOverlay}
			/>
		{/if}
	{/if}

	{#if cal.toast}
		<div class="toast"><CheckCircle size={16} />{cal.toast}</div>
	{/if}
</div>
