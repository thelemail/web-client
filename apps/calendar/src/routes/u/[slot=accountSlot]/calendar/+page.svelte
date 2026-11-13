<script lang="ts">
	import AgendaView from '$core/calendar/agenda/AgendaView.svelte';
	import AvailabilityView from '$core/calendar/availability/AvailabilityView.svelte';
	import MonthView from '$core/calendar/month/MonthView.svelte';
	import WeekView from '$core/calendar/week/WeekView.svelte';
	import { cal } from '$core/calendar/state.svelte';
	import { accountSettings } from '$core/stores/accountSettings.svelte';
	import LoadState from '$core/components/LoadState.svelte';
	import { m } from '$paraglide/messages.js';

	const settingsPending = $derived(
		accountSettings.status === 'idle' || accountSettings.status === 'loading'
	);
</script>

<svelte:head><title>{m.cal_page_title()}</title></svelte:head>

{#if settingsPending}
	<LoadState kind="loading" label={m.common_loading()} rows={4} class="cal-wait" />
{:else if cal.view === 'week'}
	<WeekView />
{:else if cal.view === 'month'}
	<MonthView />
{:else if cal.view === 'agenda'}
	<AgendaView />
{:else if cal.view === 'avail'}
	<AvailabilityView />
{:else if cal.view === 'booking' && import.meta.env.DEV}
	{#await import('$core/calendar/preview/booking/BookingView.svelte') then mod}
		<mod.default />
	{/await}
{/if}
