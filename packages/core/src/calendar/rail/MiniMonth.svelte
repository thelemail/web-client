<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { shiftAnchor } from '../range';
	import { cal } from '../state.svelte';

	const dows = $derived(
		cal.weekStartsOn === 1 ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S']
	);
</script>

<div class="mini">
	<div class="mini-h">
		<div class="mt">{cal.miniMonthLabel}</div>
		<button
			type="button"
			aria-label="Previous month"
			onclick={() => (cal.anchor = shiftAnchor(cal.anchor, 'month', -1))}
		>
			<ChevronLeft size={16} />
		</button>
		<button
			type="button"
			aria-label="Next month"
			onclick={() => (cal.anchor = shiftAnchor(cal.anchor, 'month', 1))}
		>
			<ChevronRight size={16} />
		</button>
	</div>
	<div class="mini-grid">
		{#each dows as d, i (i)}
			<div class="mini-dow">{d}</div>
		{/each}
		{#each cal.miniDays as day (day.date)}
			<button
				type="button"
				class="mini-day"
				class:out={day.outside}
				class:today={day.today}
				class:inweek={day.inWeek}
				onclick={() => cal.goToDate(day.date, cal.isDated ? cal.view : 'week')}
			>
				{day.n}
				{#if day.dot}<i class="hasdot"></i>{/if}
			</button>
		{/each}
	</div>
</div>
