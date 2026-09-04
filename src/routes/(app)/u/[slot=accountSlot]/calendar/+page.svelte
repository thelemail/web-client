<script lang="ts">
	import AgendaView from '$lib/calendar/agenda/AgendaView.svelte';
	import AvailabilityView from '$lib/calendar/availability/AvailabilityView.svelte';
	import BookingView from '$lib/calendar/booking/BookingView.svelte';
	import MonthView from '$lib/calendar/month/MonthView.svelte';
	import WeekView from '$lib/calendar/week/WeekView.svelte';
	import { cal } from '$lib/calendar/state.svelte';
</script>

{#if cal.view === 'week'}
	<WeekView />
{:else if cal.view === 'month'}
	<MonthView />
{:else if cal.view === 'agenda'}
	<AgendaView />
{:else if cal.view === 'avail'}
	<AvailabilityView />
{:else if cal.view === 'booking'}
	<BookingView />
{/if}
