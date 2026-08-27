<script lang="ts">
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import X from '@lucide/svelte/icons/x';
	import Video from '@lucide/svelte/icons/video';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Users from '@lucide/svelte/icons/users';
	import AlignLeft from '@lucide/svelte/icons/align-left';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Check from '@lucide/svelte/icons/check';
	import HelpCircle from '@lucide/svelte/icons/help-circle';
	import Avatar from '$lib/mail/Avatar.svelte';
	import { CAL_BY_ID, PPL, minutesOf, type CalEvent } from './data';
	import { fmtDayLong, fmtRange } from './format';
	import type { Rect } from './state.svelte';

	interface Props {
		ev: CalEvent;
		anchorRect: Rect;
		rsvp: 'yes' | 'maybe' | 'no' | null | undefined;
		onRsvp: (r: 'yes' | 'maybe' | 'no') => void;
		onClose: () => void;
		onEdit: () => void;
		onDelete: () => void;
	}

	let { ev, anchorRect, rsvp, onRsvp, onClose, onEdit, onDelete }: Props = $props();

	let ref: HTMLDivElement | undefined = $state();
	let pos = $state({ left: -9999, top: -9999, ready: false });

	$effect(() => {
		if (!anchorRect || !ref) return;
		const w = ref.offsetWidth;
		const h = ref.offsetHeight;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const gap = 10;
		let left = anchorRect.right + gap;
		if (left + w > vw - 8) left = anchorRect.left - gap - w;
		if (left < 8) left = Math.max(8, Math.min(anchorRect.left, vw - w - 8));
		let top = anchorRect.top - 4;
		if (top + h > vh - 8) top = Math.max(8, vh - h - 8);
		if (top < 8) top = 8;
		pos = { left, top, ready: true };
	});

	const cdef = $derived(CAL_BY_ID[ev.cal]);
	const guests = $derived(ev.guests || []);
	const organizer = $derived(ev.organizer ? PPL[ev.organizer] || null : null);
	const whenLine = $derived(
		ev.allDay
			? fmtDayLong(ev.day) +
					(ev.endDay && ev.endDay !== ev.day ? ' – ' + fmtDayLong(ev.endDay) : '') +
					' · All day'
			: `${fmtDayLong(ev.day)} · ${fmtRange(minutesOf(ev.start as string), minutesOf(ev.end as string), false)}`
	);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="pop-scrim" onclick={onClose}></div>
<div
	class="evpop"
	bind:this={ref}
	style:left="{pos.left}px"
	style:top="{pos.top}px"
	style:visibility={pos.ready ? 'visible' : 'hidden'}
	style:--c={cdef?.color}
>
	<div class="evpop-top">
		<div class="grow"></div>
		<button class="evpop-ic" title="Edit" onclick={onEdit}><Pencil size={17} /></button>
		<button class="evpop-ic danger" title="Delete" onclick={onDelete}><Trash2 size={17} /></button>
		<button class="evpop-ic" title="Close" onclick={onClose}><X size={17} /></button>
	</div>
	<div class="evpop-body">
		<div class="evpop-h">
			<span class="evpop-swatch"></span>
			<div>
				<div class="evpop-tt">{ev.title}</div>
				<div class="evpop-when">{whenLine}</div>
			</div>
		</div>
		<div class="evpop-rows">
			{#if ev.video}
				<div class="evpop-row">
					<Video size={17} />
					<div class="er-main">
						<a class="evpop-join" href={'https://' + ev.video} target="_blank" rel="noreferrer"><Video size={15} />Join with Meet</a>
						<div class="er-sub mono" style:margin-top="6px">{ev.video}</div>
					</div>
				</div>
			{/if}
			{#if ev.loc}
				<div class="evpop-row"><MapPin size={17} /><div class="er-main">{ev.loc}</div></div>
			{/if}
			{#if guests.length > 0}
				<div class="evpop-row">
					<Users size={17} />
					<div class="er-main" style:flex="1">
						<div class="er-sub" style:margin-bottom="8px">{guests.length} guests</div>
						<div class="evpop-guests">
							{#each guests as g, i (i)}
								<div class="evpop-guest">
									<Avatar initials={g.init} size={26} bg={g.bg} fg={g.fg} />
									<div class="eg-tx">
										<div class="eg-nm">{g.name}{organizer && g.email === organizer.email ? ' · organiser' : ''}</div>
										<div class="gsub mono">{g.email}</div>
									</div>
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/if}
			{#if ev.desc}
				<div class="evpop-row"><AlignLeft size={17} /><div class="er-main">{ev.desc}</div></div>
			{/if}
			<div class="evpop-row"><Calendar size={17} /><div class="er-main">{cdef?.name}</div></div>
		</div>
		{#if guests.length > 0}
			<div class="evpop-rsvp">
				<button class="yes" class:on={rsvp === 'yes'} onclick={() => onRsvp('yes')}><Check size={14} />Yes</button>
				<button class="maybe" class:on={rsvp === 'maybe'} onclick={() => onRsvp('maybe')}><HelpCircle size={14} />Maybe</button>
				<button class="no" class:on={rsvp === 'no'} onclick={() => onRsvp('no')}><X size={14} />No</button>
			</div>
		{/if}
	</div>
</div>
