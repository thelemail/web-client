<script lang="ts">
	import { MONTH_NAMES, addDays, sameDay, startOfWeek, ymd, type CalEvent } from './data';
	import { opts } from './state.svelte';

	interface Props {
		cursor: Date;
		events: CalEvent[];
		today: Date;
		onDayClick: (d: Date) => void;
		onMonthClick: (m: number) => void;
	}

	let { cursor, events, today, onDayClick, onMonthClick }: Props = $props();

	const weekStartsMon = opts.weekStartsMon;
	const dows = weekStartsMon ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

	const year = $derived(cursor.getFullYear());
	const eventDays = $derived.by(() => {
		const s = new Set<string>();
		for (const ev of events) if (ev.day.startsWith(String(year))) s.add(ev.day);
		return s;
	});

	function monthCells(m: number) {
		const gridStart = startOfWeek(new Date(year, m, 1), weekStartsMon);
		const all = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
		const lastWeek = all.slice(35);
		const trim = lastWeek.every((d) => d.getMonth() !== m);
		return trim ? all.slice(0, 35) : all;
	}
</script>

<div class="yv">
	<div class="yv-grid">
		{#each Array.from({ length: 12 }, (_, m) => m) as m (m)}
			<div class="yv-month">
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<h3 class="yv-mh" onclick={() => onMonthClick(m)}>{MONTH_NAMES[m]}</h3>
				<div class="yv-cal">
					{#each dows as d, i (i)}<div class="yv-dow">{d}</div>{/each}
					{#each monthCells(m) as d, i (i)}
						{@const out = d.getMonth() !== m}
						{@const we = d.getDay() === 0 || d.getDay() === 6}
						{@const has = !out && eventDays.has(ymd(d))}
						<button class="yv-d" class:out class:we class:today={sameDay(d, today)} onclick={() => onDayClick(new Date(d))}>
							{d.getDate()}
							{#if has && !sameDay(d, today)}<span class="ydot"></span>{/if}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	</div>
</div>
