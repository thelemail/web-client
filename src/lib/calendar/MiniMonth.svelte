<script lang="ts">
	import { untrack } from 'svelte';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { MONTH_NAMES, addDays, sameDay, startOfWeek, ymd } from './data';

	interface Props {
		cursor: Date;
		today: Date;
		selected: Date;
		weekStartsMon: boolean;
		eventDays: Set<string>;
		onPick: (d: Date) => void;
	}

	let { cursor, today, selected, weekStartsMon, eventDays, onPick }: Props = $props();

	const DOW_MINI = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
	const DOW_MINI_SUN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

	let view = $state(untrack(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1)));
	$effect(() => {
		view = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
	});

	function monthMatrix(year: number, month: number) {
		const start = startOfWeek(new Date(year, month, 1), weekStartsMon);
		return Array.from({ length: 42 }, (_, i) => addDays(start, i));
	}

	const cells = $derived(monthMatrix(view.getFullYear(), view.getMonth()));
	const selWeekStart = $derived(ymd(startOfWeek(selected, weekStartsMon)));
	const dows = $derived(weekStartsMon ? DOW_MINI : DOW_MINI_SUN);
</script>

<div class="mini">
	<div class="mini-h">
		<span class="mt">{MONTH_NAMES[view.getMonth()]} {view.getFullYear()}</span>
		<button
			title="Previous month"
			onclick={() => (view = new Date(view.getFullYear(), view.getMonth() - 1, 1))}
		>
			<ChevronLeft size={16} />
		</button>
		<button
			title="Next month"
			onclick={() => (view = new Date(view.getFullYear(), view.getMonth() + 1, 1))}
		>
			<ChevronRight size={16} />
		</button>
	</div>
	<div class="mini-grid">
		{#each dows as d, i (i)}
			<div class="mini-dow">{d}</div>
		{/each}
		{#each cells as d, i (i)}
			{@const out = d.getMonth() !== view.getMonth()}
			{@const isToday = sameDay(d, today)}
			{@const isSel = sameDay(d, selected)}
			{@const inWeek = ymd(startOfWeek(d, weekStartsMon)) === selWeekStart}
			{@const has = eventDays.has(ymd(d))}
			<button
				class="mini-day"
				class:out
				class:today={isToday}
				class:sel={isSel}
				class:inweek={inWeek}
				onclick={() => onPick(new Date(d))}
			>
				{d.getDate()}
				{#if has && !isToday}<span class="hasdot"></span>{/if}
			</button>
		{/each}
	</div>
</div>
