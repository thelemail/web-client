<script lang="ts">
	import TimeGrid from '$lib/calendar/TimeGrid.svelte';
	import MonthView from '$lib/calendar/MonthView.svelte';
	import YearView from '$lib/calendar/YearView.svelte';
	import ScheduleView from '$lib/calendar/ScheduleView.svelte';
	import { cal, TODAY } from '$lib/calendar/state.svelte';

	const selId = $derived(cal.overlay?.type === 'popover' ? cal.overlay.ev.id : undefined);

	function handleKey(e: KeyboardEvent) {
		const tag = (document.activeElement as HTMLElement | null)?.tagName;
		if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag ?? '')) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const key = e.key.toLowerCase();
		if (key === 't') cal.goToday();
		else if (key === 'c') cal.openCreate('event');
		else if (key === 'd') cal.setView('day');
		else if (key === 'w') cal.setView('week');
		else if (key === 'm') cal.setView('month');
		else if (key === 'y') cal.setView('year');
		else if (key === 's' || key === 'a') cal.setView('schedule');
		else if (key === 'x') cal.setView('4day');
		else if (e.key === 'ArrowLeft') cal.step(-1);
		else if (e.key === 'ArrowRight') cal.step(1);
	}
</script>

<svelte:document onkeydown={handleKey} />

{#if cal.view === 'day' || cal.view === 'week' || cal.view === '4day'}
	<TimeGrid
		days={cal.days}
		events={cal.shown}
		today={TODAY}
		{selId}
		onEventClick={cal.openEvent}
		onSlotClick={cal.openSlot}
		onDateClick={cal.goDay}
	/>
{:else if cal.view === 'month'}
	<MonthView
		cursor={cal.cursor}
		events={cal.shown}
		today={TODAY}
		{selId}
		onEventClick={cal.openEvent}
		onDayClick={(d, el) => cal.openSlot(d, null, el)}
		onDateClick={cal.goDay}
		onMore={cal.goDay}
	/>
{:else if cal.view === 'year'}
	<YearView
		cursor={cal.cursor}
		events={cal.shown}
		today={TODAY}
		onDayClick={cal.goDay}
		onMonthClick={cal.gotoMonth}
	/>
{:else if cal.view === 'schedule'}
	<ScheduleView cursor={cal.cursor} events={cal.shown} today={TODAY} onEventClick={cal.openEvent} />
{/if}
