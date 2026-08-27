<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Clock from '@lucide/svelte/icons/clock';
	import CalendarCheck from '@lucide/svelte/icons/calendar-check';
	import Palette from '@lucide/svelte/icons/palette';
	import Check from '@lucide/svelte/icons/check';
	import { CALENDARS } from './data';
	import type { Draft, Rect } from './state.svelte';

	interface Props {
		anchorRect: Rect;
		draft: Draft;
		onClose: () => void;
		onChange: (patch: Partial<Draft>) => void;
		onSave: () => void;
		onMore: () => void;
	}

	let { anchorRect, draft, onClose, onChange, onSave, onMore }: Props = $props();

	const mine = CALENDARS.filter((c) => c.group === 'mine');

	let ref: HTMLDivElement | undefined = $state();
	let titleRef: HTMLInputElement | undefined = $state();
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

	$effect(() => {
		const t = setTimeout(() => titleRef?.focus(), 30);
		return () => clearTimeout(t);
	});

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') onSave();
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="pop-scrim" onclick={onClose}></div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="qc"
	bind:this={ref}
	style:left="{pos.left}px"
	style:top="{pos.top}px"
	style:visibility={pos.ready ? 'visible' : 'hidden'}
	onkeydown={onKeyDown}
>
	<div class="qc-top">
		<div class="grow"></div>
		<button class="evpop-ic" title="Close" onclick={onClose}><X size={17} /></button>
	</div>
	<div class="qc-body">
		<input
			bind:this={titleRef}
			class="qc-title"
			placeholder="Add title"
			value={draft.title}
			oninput={(e) => onChange({ title: (e.currentTarget as HTMLInputElement).value })}
		/>
		<div class="qc-seg">
			<button class:on={draft.kind === 'event'} onclick={() => onChange({ kind: 'event' })}>Event</button>
			<button class:on={draft.kind === 'task'} onclick={() => onChange({ kind: 'task' })}>Task</button>
			<button class:on={draft.kind === 'focus'} onclick={() => onChange({ kind: 'focus' })}>Focus</button>
		</div>
		<div class="qc-row">
			<Clock size={17} />
			<div class="qc-fields">
				<input type="date" class="qc-inp" value={draft.day} oninput={(e) => onChange({ day: (e.currentTarget as HTMLInputElement).value })} />
				{#if !draft.allDay}
					<input type="time" class="qc-inp time" value={draft.start} oninput={(e) => onChange({ start: (e.currentTarget as HTMLInputElement).value })} />
					<span style:color="var(--fg-faint)">–</span>
					<input type="time" class="qc-inp time" value={draft.end} oninput={(e) => onChange({ end: (e.currentTarget as HTMLInputElement).value })} />
				{/if}
			</div>
		</div>
		<div class="qc-row">
			<CalendarCheck size={17} />
			<div class="qc-fields">
				<label style:display="inline-flex" style:align-items="center" style:gap="8px" style:font-size="13px">
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
					<span class="ck-sm" class:on={draft.allDay} onclick={() => onChange({ allDay: !draft.allDay })}><Check size={12} /></span>
					All day
				</label>
			</div>
		</div>
		<div class="qc-row" style:border-bottom="none">
			<Palette size={17} />
			<div class="qc-cals">
				{#each mine as c (c.id)}
					<button class="qc-caldot" class:on={draft.cal === c.id} style:--c={c.color} title={c.name} onclick={() => onChange({ cal: c.id })}><i></i></button>
				{/each}
			</div>
		</div>
		<div class="qc-foot">
			<button class="qc-more" onclick={onMore}>More options</button>
			<button class="qc-save" onclick={onSave}>Save</button>
		</div>
	</div>
</div>
