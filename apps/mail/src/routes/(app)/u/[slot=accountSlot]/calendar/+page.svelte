<script lang="ts">
	import AgendaView from '$core/calendar/agenda/AgendaView.svelte';
	import AvailabilityView from '$core/calendar/availability/AvailabilityView.svelte';
	import MonthView from '$core/calendar/month/MonthView.svelte';
	import WeekView from '$core/calendar/week/WeekView.svelte';
	import { cal } from '$core/calendar/state.svelte';
</script>

<svelte:head><title>Thelemail — Calendar</title></svelte:head>

{#if cal.view === 'week'}
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
