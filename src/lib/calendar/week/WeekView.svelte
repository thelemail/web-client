<script lang="ts">
	import { NOW_MINUTES, ZONE } from '../fixtures';
	import { HOUR_HEIGHT, cal } from '../state.svelte';
	import AllDayBand from './AllDayBand.svelte';
	import ItemBlock from './ItemBlock.svelte';
	import Legend from './Legend.svelte';

	let scroller = $state<HTMLDivElement>();
	let scrolled = false;

	$effect(() => {
		if (!scroller || scrolled) return;
		scrolled = true;
		scroller.scrollTop = HOUR_HEIGHT - 10;
	});

	const nowLabel = `${String(Math.floor(NOW_MINUTES / 60)).padStart(2, '0')}:${String(
		NOW_MINUTES % 60
	).padStart(2, '0')}`;
</script>

<Legend />

<div class="tg" style:--start-h={cal.startHour}>
	<div class="tg-head">
		<div class="tg-corner">{ZONE}</div>
		{#each cal.days as day (day.dow)}
			<button
				type="button"
				class="tg-dh"
				class:is-today={day.today}
				class:is-weekend={day.weekend}
				onclick={() => cal.goTo('week')}
			>
				<span class="tg-dow">{day.dow}</span>
				<span class="tg-dnum">{day.num}</span>
			</button>
		{/each}
	</div>

	<AllDayBand />

	<div class="tg-scroll" bind:this={scroller}>
		<div class="tg-grid">
			<div class="tg-gutter">
				{#each cal.hours as hour (hour.label)}
					<div class="tg-hr" style:--top="{hour.top}px">{hour.label}</div>
				{/each}
			</div>
			{#each cal.days as day (day.dow)}
				<div class="tg-col" class:is-weekend={day.weekend} class:work-shade={!day.weekend}>
					{#each day.buffers as buffer (buffer.top)}
						<div class="ev-buf" style:--top="{buffer.top}px" style:--h="{buffer.height}px">
							{buffer.label}
						</div>
					{/each}
					{#each day.blocks as block (block.id)}
						<ItemBlock {block} />
					{/each}
					{#if day.today}
						<div class="now-line" style:--top="{cal.nowTop}px">
							<div class="nl"></div>
							<div class="now-flag">{nowLabel}</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
