<script lang="ts">
	import {
		CAL_BY_ID,
		MONTH_ABBR,
		addDays,
		minutesOf,
		sameDay,
		startOfMonth,
		startOfWeek,
		ymd,
		type CalEvent
	} from './data';
	import { fmtTime } from './format';
	import { opts } from './state.svelte';

	interface Props {
		cursor: Date;
		events: CalEvent[];
		today: Date;
		selId?: string;
		onEventClick: (ev: CalEvent, el: HTMLElement | null) => void;
		onDayClick: (d: Date, el: HTMLElement | null) => void;
		onDateClick: (d: Date) => void;
		onMore: (d: Date) => void;
	}

	let { cursor, events, today, onEventClick, onDayClick, onDateClick, onMore }: Props = $props();

	const { weekStartsMon, showWeekends, h12, density } = opts;
	const cap = density === 'compact' ? 4 : 3;
	const isWE = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

	const cols = $derived(showWeekends ? 7 : 5);
	const dowFull = $derived(
		weekStartsMon
			? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
			: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
	);
	const dowShown = $derived(
		dowFull.filter((_, i) => showWeekends || (weekStartsMon ? i < 5 : i > 0 && i < 6))
	);

	const cells = $derived.by(() => {
		const gridStart = startOfWeek(startOfMonth(cursor), weekStartsMon);
		const all = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
		return showWeekends ? all : all.filter((d) => !isWE(d));
	});

	function dayEvents(d: Date) {
		const key = ymd(d);
		const adEvents = events.filter((ev) => ev.allDay && key >= ev.day && key <= (ev.endDay || ev.day));
		const timed = events
			.filter((ev) => !ev.allDay && ev.day === key)
			.sort((a, b) => minutesOf(a.start as string) - minutesOf(b.start as string));
		return [
			...adEvents.map((e) => ({ e, allDay: true })),
			...timed.map((e) => ({ e, allDay: false }))
		];
	}
</script>

<div class="mv">
	<div class="mv-dow" style:--cols={cols}>
		{#each dowShown as d, i (i)}
			<div class:we={d === 'Sat' || d === 'Sun'}>{d}</div>
		{/each}
	</div>
	<div class="mv-grid" style:--cols={cols}>
		{#each cells as d, i (i)}
			{@const out = d.getMonth() !== cursor.getMonth()}
			{@const evs = dayEvents(d)}
			{@const shownEvs = evs.slice(0, cap)}
			{@const extra = evs.length - shownEvs.length}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class="mv-cell"
				class:out
				class:we={isWE(d)}
				class:is-today={sameDay(d, today)}
				onclick={(e) => onDayClick(d, e.currentTarget as HTMLElement)}
			>
				<div class="mv-dh">
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<span class="mv-dnum" onclick={(e) => { e.stopPropagation(); onDateClick(d); }}>
						{d.getDate() === 1 ? MONTH_ABBR[d.getMonth()] + ' 1' : d.getDate()}
					</span>
				</div>
				{#each shownEvs as { e, allDay } (e.id)}
					{@const cdef = CAL_BY_ID[e.cal]}
					{@const solid = allDay && (e.cal === 'birthdays' || e.cal === 'holidays')}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div
						class="mv-mev"
						class:allday={allDay}
						class:solid
						style:--c={cdef?.color}
						style:background={solid ? cdef?.color : undefined}
						style:color={solid ? '#fff' : undefined}
						style:border-color={solid ? 'transparent' : undefined}
						onclick={(ev) => { ev.stopPropagation(); onEventClick(e, ev.currentTarget as HTMLElement); }}
					>
						{#if !allDay}<span class="mev-dot"></span>{/if}
						{#if !allDay}<span class="mev-tm">{fmtTime(minutesOf(e.start as string), h12)}</span>{/if}
						<span class="mev-t">{e.title}</span>
					</div>
				{/each}
				{#if extra > 0}
					<button class="mv-more" onclick={(ev) => { ev.stopPropagation(); onMore(d); }}>{extra} more</button>
				{/if}
			</div>
		{/each}
	</div>
</div>
