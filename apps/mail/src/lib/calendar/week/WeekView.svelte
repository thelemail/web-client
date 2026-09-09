<script lang="ts">
	import { HOUR_HEIGHT, cal } from '../state.svelte';
	import { calendarStore } from '../store.svelte';
	import AllDayBand from './AllDayBand.svelte';
	import ItemBlock from './ItemBlock.svelte';
	import Legend from './Legend.svelte';

	let scroller = $state<HTMLDivElement>();
	let scrolled = false;

	$effect(() => {
		if (!scroller || scrolled) return;
		scrolled = true;
		scroller.scrollTop = Math.max(0, cal.nowTop - HOUR_HEIGHT * 2);
	});

	function createAt(date: string, ev: MouseEvent) {
		if (!calendarStore.writableCalendars.length) return;
		const target = ev.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const minutes = Math.floor(((ev.clientY - rect.top) / HOUR_HEIGHT) * 60) + cal.startHour * 60;
		const snapped = Math.max(0, Math.min(23 * 60 + 30, Math.round(minutes / 30) * 30));
		const hh = String(Math.floor(snapped / 60)).padStart(2, '0');
		const mm = String(snapped % 60).padStart(2, '0');
		const endMin = Math.min(24 * 60 - 1, snapped + 60);
		const eh = String(Math.floor(endMin / 60)).padStart(2, '0');
		const em = String(endMin % 60).padStart(2, '0');
		cal.openEditor({
			mode: 'create',
			kind: 'event',
			prefill: { date, startWall: `${date}T${hh}:${mm}:00`, endWall: `${date}T${eh}:${em}:00` }
		});
	}
</script>

<Legend />

<div class="tg" style:--start-h={cal.startHour}>
	<div class="tg-head">
		<div class="tg-corner">{cal.zoneLabel}</div>
		{#each cal.days as day (day.date)}
			<button
				type="button"
				class="tg-dh"
				class:is-today={day.today}
				class:is-weekend={day.weekend}
				onclick={() => cal.goToDate(day.date, 'agenda')}
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
			{#each cal.days as day (day.date)}
				<div
					class="tg-col"
					class:is-weekend={day.weekend}
					class:work-shade={!day.weekend}
					role="presentation"
					ondblclick={(ev) => createAt(day.date, ev)}
				>
					{#each day.blocks as block (block.id)}
						<ItemBlock {block} />
					{/each}
					{#if day.today}
						<div class="now-line" style:--top="{cal.nowTop}px">
							<div class="nl"></div>
							<div class="now-flag">{cal.nowLabel}</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
