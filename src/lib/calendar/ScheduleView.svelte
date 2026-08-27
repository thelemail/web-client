<script lang="ts">
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Video from '@lucide/svelte/icons/video';
	import {
		CAL_BY_ID,
		MONTH_ABBR,
		addDays,
		minutesOf,
		sameDay,
		startOfWeek,
		ymd,
		type CalEvent
	} from './data';
	import { fmtRange } from './format';
	import { opts } from './state.svelte';

	interface Props {
		cursor: Date;
		events: CalEvent[];
		today: Date;
		onEventClick: (ev: CalEvent, el: HTMLElement | null) => void;
	}

	let { cursor, events, today, onEventClick }: Props = $props();

	const h12 = opts.h12;
	const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	const rows = $derived.by(() => {
		const start = startOfWeek(cursor, opts.weekStartsMon);
		const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
		return days
			.map((d) => {
				const key = ymd(d);
				const adEvents = events.filter((ev) => ev.allDay && key >= ev.day && key <= (ev.endDay || ev.day));
				const timed = events
					.filter((ev) => !ev.allDay && ev.day === key)
					.sort((a, b) => minutesOf(a.start as string) - minutesOf(b.start as string));
				return {
					d,
					items: [
						...adEvents.map((e) => ({ e, allDay: true })),
						...timed.map((e) => ({ e, allDay: false }))
					]
				};
			})
			.filter((r) => r.items.length);
	});
</script>

<div class="sv">
	{#if rows.length === 0}
		<div class="sv-empty">
			<div class="serif">Nothing scheduled</div>
			<div style:margin-top="6px" style:font-size="13px">
				No events in this stretch of the archive. Press <b>Today</b> to return.
			</div>
		</div>
	{:else}
		<div class="sv-inner">
			{#each rows as { d, items } (ymd(d))}
				<div class="sv-day" class:is-today={sameDay(d, today)}>
					<div class="sv-date">
						<div class="sd-dow">{DOW[d.getDay()].slice(0, 3)}</div>
						<div class="sd-num">{d.getDate()}</div>
						<div class="sd-mon">{MONTH_ABBR[d.getMonth()]}</div>
						{#if sameDay(d, today)}<span class="sd-today">Today</span>{/if}
					</div>
					<div class="sv-list">
						{#each items as { e, allDay } (e.id)}
							{@const cdef = CAL_BY_ID[e.cal]}
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<div class="sv-row" style:--c={cdef?.color} onclick={(ev) => onEventClick(e, ev.currentTarget as HTMLElement)}>
								<span class="sv-time">
									{allDay ? 'All day' : fmtRange(minutesOf(e.start as string), minutesOf(e.end as string), h12)}
								</span>
								<span class="sv-bar"></span>
								<div class="sv-main">
									<div class="sv-t">{e.title}</div>
									<div class="sv-meta">
										<span class="sv-cal">
											<span style:width="8px" style:height="8px" style:border-radius="50%" style:background={cdef?.color} style:display="inline-block"></span>
											{cdef?.name}
										</span>
										{#if e.loc}<MapPin size={13} />{e.loc}{/if}
										{#if e.video}<Video size={13} />Meet{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
