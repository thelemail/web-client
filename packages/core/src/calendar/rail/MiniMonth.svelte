<script lang="ts">
	import Icon from '$core/components/Icon.svelte';
	import { Button } from '$core/components/ui/button';
	import { faChevronLeft, faChevronRight } from '@fortawesome/pro-regular-svg-icons';
	import { m } from '$paraglide/messages.js';
	import { shiftAnchor } from '../range';
	import { cal } from '../state.svelte';
	import { weekdayNames } from '$core/i18n/intl';

	const dows = $derived(weekdayNames('narrow', cal.weekStartsOn === 1));
</script>

<div class="mini">
	<div class="mini-h">
		<div class="mt">{cal.miniMonthLabel}</div>
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label={m.cal_mini_prev_month()}
			onclick={() => (cal.anchor = shiftAnchor(cal.anchor, 'month', -1))}
		>
			<Icon icon={faChevronLeft} size={16} />
		</Button>
		<Button
			variant="ghost"
			size="icon-xs"
			aria-label={m.cal_mini_next_month()}
			onclick={() => (cal.anchor = shiftAnchor(cal.anchor, 'month', 1))}
		>
			<Icon icon={faChevronRight} size={16} />
		</Button>
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
