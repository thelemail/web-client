<script lang="ts">
	import Video from '@lucide/svelte/icons/video';
	import { CAL_BY_ID, minutesOf, sameDay, ymd, type CalEvent } from './data';
	import { fmtTime } from './format';
	import { opts } from './state.svelte';

	interface Props {
		days: Date[];
		events: CalEvent[];
		today: Date;
		selId?: string;
		onEventClick: (ev: CalEvent, el: HTMLElement | null) => void;
		onSlotClick: (day: Date, min: number | null, el: HTMLElement | null) => void;
		onDateClick: (d: Date) => void;
	}

	let { days, events, today, selId, onEventClick, onSlotClick, onDateClick }: Props = $props();

	const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const hours = Array.from({ length: 23 }, (_, i) => i + 1);
	const hourH = opts.hourH;
	const h12 = opts.h12;

	interface Laid extends CalEvent {
		s: number;
		e: number;
		_col: number;
		_ncol: number;
	}

	function timedFor(list: CalEvent[], day: Date): Laid[] {
		const key = ymd(day);
		return list
			.filter((ev) => !ev.allDay && ev.day === key)
			.map((ev) => ({
				...ev,
				s: minutesOf(ev.start as string),
				e: Math.max(minutesOf(ev.end as string), minutesOf(ev.start as string) + 20),
				_col: 0,
				_ncol: 1
			}));
	}

	function layoutDay(items: Laid[]): Laid[] {
		const sorted = items.slice().sort((a, b) => a.s - b.s || b.e - a.e);
		const out: Laid[] = [];
		let cluster: Laid[] = [];
		let clusterEnd = -1;
		const flush = () => {
			if (!cluster.length) return;
			const colEnds: number[] = [];
			for (const it of cluster) {
				let c = colEnds.findIndex((end) => end <= it.s);
				if (c === -1) {
					c = colEnds.length;
					colEnds.push(it.e);
				} else colEnds[c] = it.e;
				it._col = c;
			}
			for (const it of cluster) it._ncol = colEnds.length;
			out.push(...cluster);
			cluster = [];
			clusterEnd = -1;
		};
		for (const it of sorted) {
			if (cluster.length && it.s >= clusterEnd) flush();
			cluster.push(it);
			clusterEnd = Math.max(clusterEnd, it.e);
		}
		flush();
		return out;
	}

	interface AdItem {
		ev: CalEvent;
		startIdx: number;
		endIdx: number;
		_row: number;
	}

	function layoutAllDay(list: CalEvent[], dayList: Date[]): { items: AdItem[] } {
		const keys = dayList.map(ymd);
		const first = keys[0];
		const last = keys[keys.length - 1];
		const base = list
			.filter((ev) => ev.allDay)
			.map((ev) => ({ ev, sd: ev.day, ed: ev.endDay || ev.day }))
			.filter((x) => x.ed >= first && x.sd <= last)
			.map((x) => {
				const si = keys.indexOf(x.sd);
				const ei = keys.indexOf(x.ed);
				return {
					ev: x.ev,
					startIdx: Math.max(0, si === -1 ? 0 : si),
					endIdx: x.ed > last ? keys.length - 1 : ei === -1 ? keys.length - 1 : ei,
					_row: 0
				};
			});
		const sorted = base.sort((a, b) => a.startIdx - b.startIdx || b.endIdx - a.endIdx);
		const rows: AdItem[][] = [];
		for (const it of sorted) {
			let r = rows.findIndex((row) => row.every((p) => it.startIdx > p.endIdx || it.endIdx < p.startIdx));
			if (r === -1) {
				r = rows.length;
				rows.push([]);
			}
			rows[r].push(it);
			it._row = r;
		}
		return { items: sorted };
	}

	const cols = $derived(days.length);
	const ad = $derived(layoutAllDay(events, days));
	const hasAllDay = $derived(ad.items.length > 0);
	const nowMin = $derived(today.getHours() * 60 + today.getMinutes());

	let scrollRef: HTMLDivElement | undefined = $state();
	$effect(() => {
		void days;
		if (scrollRef) scrollRef.scrollTop = Math.max(0, 7.5 * hourH - 12);
	});

	function slotClick(e: MouseEvent, d: Date) {
		const el = e.currentTarget as HTMLElement;
		const rect = el.getBoundingClientRect();
		const y = e.clientY - rect.top;
		const min = Math.max(0, (Math.round((y / hourH) * 2) / 2) * 60);
		onSlotClick(d, Math.min(min, 23 * 60 + 30), el);
	}
</script>

<div class="tg" style:--cols={cols} style:--hour-h="{hourH}px" style:--work-a={opts.workStart} style:--work-b={opts.workEnd}>
	<div class="tg-head">
		<div class="tg-corner">{h12 ? 'GMT+2' : 'CEST'}</div>
		{#each days as d, i (i)}
			{@const we = d.getDay() === 0 || d.getDay() === 6}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="tg-dh" class:is-today={sameDay(d, today)} class:is-weekend={we} onclick={() => onDateClick(d)}>
				<span class="tg-dow">{DOW[d.getDay()]}</span>
				<span class="tg-dnum">{d.getDate()}</span>
			</div>
		{/each}
	</div>

	{#if hasAllDay}
		<div class="tg-allday">
			<div class="tg-allday-lbl">All-day</div>
			<div class="tg-allday-track" style:--cols={cols}>
				<div class="tg-allday-cells">{#each days as _, i (i)}<i></i>{/each}</div>
				{#each ad.items as item (item.ev.id)}
					{@const cdef = CAL_BY_ID[item.ev.cal]}
					{@const solid = item.ev.cal === 'birthdays' || item.ev.cal === 'holidays'}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<div
						class="adev"
						class:solid
						class:sel={selId === item.ev.id}
						style:--c={cdef?.color}
						style:--colstart={item.startIdx + 1}
						style:--colspan={item.endIdx - item.startIdx + 1}
						style:--row={item._row + 1}
						onclick={(e) => { e.stopPropagation(); onEventClick(item.ev, e.currentTarget as HTMLElement); }}
					>
						{#if !solid}<span class="ad-dot"></span>{/if}
						<span class="ad-t">{item.ev.title}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div class="tg-scroll" bind:this={scrollRef}>
		<div class="tg-grid">
			<div class="tg-gutter">
				{#each hours as h (h)}
					<div class="tg-hr" style:top="{h * hourH}px">{fmtTime(h * 60, h12)}</div>
				{/each}
			</div>
			{#each days as d, i (i)}
				{@const we = d.getDay() === 0 || d.getDay() === 6}
				{@const laid = layoutDay(timedFor(events, d))}
				{@const isToday = sameDay(d, today)}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div class="tg-col" class:is-weekend={we} class:work-shade={opts.workShade && !we} onclick={(e) => slotClick(e, d)}>
					{#each laid as it (it.id)}
						{@const top = (it.s / 60) * hourH}
						{@const height = ((it.e - it.s) / 60) * hourH}
						{@const w = 100 / it._ncol}
						{@const left = it._col * w}
						{@const tiny = height < 32}
						{@const cdef = CAL_BY_ID[it.cal]}
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<div
							class="ev"
							class:tiny
							class:sel={selId === it.id}
							style:--c={cdef?.color}
							style:top="{top}px"
							style:height="{Math.max(height - 1, 16)}px"
							style:left="calc({left}% + 2px)"
							style:width="calc({w}% - 4px)"
							onclick={(e) => { e.stopPropagation(); onEventClick(it, e.currentTarget as HTMLElement); }}
						>
							{#if tiny}
								<div class="ev-t">
									{#if it.video}<span class="ev-ic"><Video size={11} /></span>{/if}
									{fmtTime(it.s, h12)} · {it.title}
								</div>
							{:else}
								<div class="ev-t">
									{#if it.video}<span class="ev-ic"><Video size={11} /></span>{/if}
									{it.title}
								</div>
								<div class="ev-w">
									{fmtTime(it.s, h12)}{height > 56 ? ` – ${fmtTime(it.e, h12)}` : ''}{it.loc ? ` · ${it.loc}` : ''}
								</div>
							{/if}
						</div>
					{/each}
					{#if isToday}
						<div class="now-line" style:top="{(nowMin / 60) * hourH}px"><div class="nl"></div></div>
						<div class="now-flag" style:top="{(nowMin / 60) * hourH}px">{fmtTime(nowMin, h12)}</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
