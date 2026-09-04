<script lang="ts">
	import CalendarPlus from '@lucide/svelte/icons/calendar-plus';
	import X from '@lucide/svelte/icons/x';
	import Clock from '@lucide/svelte/icons/clock';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Users from '@lucide/svelte/icons/users';
	import Palette from '@lucide/svelte/icons/palette';
	import AlignLeft from '@lucide/svelte/icons/align-left';
	import Check from '@lucide/svelte/icons/check';
	import { untrack } from 'svelte';
	import { CALENDARS } from './data';
	import type { Draft } from './state.svelte';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		initial: Draft;
		isEdit: boolean;
		onClose: () => void;
		onSave: (draft: Draft) => void;
		onDelete: () => void;
	}

	let { initial, isEdit, onClose, onSave, onDelete }: Props = $props();

	const mine = CALENDARS.filter((c) => c.group === 'mine');
	let f = $state<Draft>(untrack(() => ({ ...initial })));
	const set = (patch: Partial<Draft>) => (f = { ...f, ...patch });

	function toggleVideo() {
		set({
			video: f.video ? null : 'meet.thelema.co/' + (f.title || 'event').toLowerCase().replace(/[^a-z]+/g, '').slice(0, 8)
		});
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onClose()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dlg-scrim" onmousedown={onClose}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="dlg" onmousedown={(e) => e.stopPropagation()}>
		<div class="dlg-h">
			<CalendarPlus size={18} />
			<span class="dt">{isEdit ? 'Edit event' : 'New event'}</span>
			<button class="dlg-x" onclick={onClose}><X size={18} /></button>
		</div>
		<div class="dlg-body">
			<input class="dlg-title" placeholder="Add title" value={f.title} oninput={(e) => set({ title: (e.currentTarget as HTMLInputElement).value })} />

			<div class="dlg-field">
				<Clock size={18} />
				<div class="dff">
					<div class="dlg-label">When</div>
					<div class="dlg-times">
						<input type="date" class="dlg-inp" value={f.day} oninput={(e) => set({ day: (e.currentTarget as HTMLInputElement).value })} />
						{#if !f.allDay}
							<input type="time" class="dlg-inp" value={f.start} oninput={(e) => set({ start: (e.currentTarget as HTMLInputElement).value })} />
							<span class="sep">–</span>
							<input type="time" class="dlg-inp" value={f.end} oninput={(e) => set({ end: (e.currentTarget as HTMLInputElement).value })} />
						{/if}
					</div>
					<label class="dlg-toggle-row" style:margin-top="10px">
						<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
						<span class="ck-sm" class:on={f.allDay} onclick={() => set({ allDay: !f.allDay })}><Check size={12} /></span>
						All day
						<span style:margin-left="16px" style:color="var(--fg-faint)">·</span>
						<span style:display="inline-flex" style:align-items="center" style:gap="8px">
							<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
							<span class="ck-sm" class:on={!!f.video} onclick={toggleVideo}><Check size={12} /></span>
							Add Thélème Meet
						</span>
					</label>
				</div>
			</div>

			<div class="dlg-field">
				<MapPin size={18} />
				<div class="dff">
					<div class="dlg-label">Location</div>
					<input class="dlg-inp" placeholder="Add a place" value={f.loc || ''} oninput={(e) => set({ loc: (e.currentTarget as HTMLInputElement).value })} />
				</div>
			</div>

			<div class="dlg-field">
				<Users size={18} />
				<div class="dff">
					<div class="dlg-label">Guests</div>
					<input class="dlg-inp" placeholder="Add guests, comma separated" value={f.guestText || ''} oninput={(e) => set({ guestText: (e.currentTarget as HTMLInputElement).value })} />
				</div>
			</div>

			<div class="dlg-field">
				<Palette size={18} />
				<div class="dff">
					<div class="dlg-label">Calendar</div>
					<div class="dlg-chips">
						{#each mine as c (c.id)}
							<button class="dlg-chip" class:on={f.cal === c.id} style:--c={c.color} onclick={() => set({ cal: c.id })}><i></i>{c.name}</button>
						{/each}
					</div>
				</div>
			</div>

			<div class="dlg-field">
				<AlignLeft size={18} />
				<div class="dff">
					<div class="dlg-label">Description</div>
					<textarea class="dlg-inp" placeholder="Add notes, agenda, links…" value={f.desc || ''} oninput={(e) => set({ desc: (e.currentTarget as HTMLTextAreaElement).value })}></textarea>
				</div>
			</div>
		</div>
		<div class="dlg-foot">
			{#if isEdit}
				<Button variant="danger" onclick={onDelete}>Delete</Button>
			{/if}
			<div class="grow"></div>
			<Button variant="secondary" onclick={onClose}>Cancel</Button>
			<Button variant="primary" onclick={() => onSave(f)}>{isEdit ? 'Save changes' : 'Save'}</Button>
		</div>
	</div>
</div>
