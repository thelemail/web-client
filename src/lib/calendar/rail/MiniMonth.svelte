<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { MONTH_LABEL, YEAR_LABEL } from '../fixtures';
	import { cal } from '../state.svelte';
</script>

<div class="mini">
	<div class="mini-h">
		<div class="mt">{MONTH_LABEL} {YEAR_LABEL}</div>
		<button type="button" aria-label="Previous month" onclick={() => cal.unbuilt()}>
			<ChevronLeft size={16} />
		</button>
		<button type="button" aria-label="Next month" onclick={() => cal.unbuilt()}>
			<ChevronRight size={16} />
		</button>
	</div>
	<div class="mini-grid">
		<div class="mini-dow">M</div>
		<div class="mini-dow">T</div>
		<div class="mini-dow">W</div>
		<div class="mini-dow">T</div>
		<div class="mini-dow">F</div>
		<div class="mini-dow">S</div>
		<div class="mini-dow">S</div>
		{#each cal.miniDays as day, i (i)}
			<button
				type="button"
				class="mini-day"
				class:out={day.outside}
				class:today={day.today}
				class:inweek={day.inWeek}
				onclick={() => cal.goTo('week')}
			>
				{day.n}
				{#if day.dot}<i class="hasdot"></i>{/if}
			</button>
		{/each}
	</div>
</div>
