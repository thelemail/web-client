<script lang="ts">
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import ClockArrowLeft from '@lucide/svelte/icons/clock-arrow-left';
	import Copy from '@lucide/svelte/icons/copy';
	import Mail from '@lucide/svelte/icons/mail';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import Video from '@lucide/svelte/icons/video';
	import X from '@lucide/svelte/icons/x';
	import Avatar from '$core/components/Avatar.svelte';
	import * as Popover from '$core/components/ui/popover';
	import DisclosureBoundary from './DisclosureBoundary.svelte';
	import type { Partstat } from './model';
	import { cal } from './state.svelte';
	import { calendarStore } from './store.svelte';
	import type { Selection } from './types';

	interface Props {
		selection: Selection;
		onClose: () => void;
	}

	let { selection, onClose }: Props = $props();

	const RSVP: { value: Partstat; label: string; icon: typeof Check; cls: string }[] = [
		{ value: 'accepted', label: 'Yes', icon: Check, cls: 'yes' },
		{ value: 'tentative', label: 'Maybe', icon: CircleAlert, cls: 'maybe' },
		{ value: 'declined', label: 'No', icon: X, cls: 'no' }
	];

	function edit() {
		onClose();
		if (selection.occ.item.rrule) {
			cal.requestScope({ occ: selection.occ, action: 'edit' });
			return;
		}
		cal.openEditor({ mode: 'edit', occ: selection.occ, item: selection.occ.item });
	}

	function duplicate() {
		onClose();
		cal.openEditor({ mode: 'duplicate', occ: selection.occ, item: selection.occ.item });
	}

	async function remove() {
		onClose();
		if (selection.occ.item.rrule) {
			cal.requestScope({ occ: selection.occ, action: 'delete' });
			return;
		}
		await calendarStore.deleteItem(selection.occ.item.id);
		cal.notify(`Deleted “${selection.title}”`);
	}

	function history() {
		onClose();
		cal.openHistory(selection.occ.item.id);
	}

	async function respond(value: Partstat) {
		onClose();
		await cal.setPartstat(selection.occ, value);
	}
</script>

<Popover.Content class="cal-surface cal-pop" align="start" side="right" sideOffset={10}>
	<div class="evpop-top">
		<div class="grow"></div>
		{#if selection.canEdit}
			<button type="button" class="evpop-ic" aria-label="Edit" onclick={edit}>
				<PenLine size={17} />
			</button>
			<button type="button" class="evpop-ic" aria-label="Duplicate" onclick={duplicate}>
				<Copy size={17} />
			</button>
			<button type="button" class="evpop-ic danger" aria-label="Delete" onclick={remove}>
				<Trash2 size={17} />
			</button>
		{/if}
		<button type="button" class="evpop-ic" aria-label="Close" onclick={onClose}>
			<X size={17} />
		</button>
	</div>
	<div class="evpop-body">
		<div class="evpop-h">
			<span class="evpop-swatch" style:--c={selection.color}></span>
			<div>
				<div class="evpop-tt">{selection.title}</div>
				<div class="evpop-when">{selection.whenLong}</div>
			</div>
		</div>
		<div class="evpop-rows">
			{#if selection.loc}
				<div class="evpop-row">
					<MapPin size={17} />
					<div class="er-main">{selection.loc}</div>
				</div>
			{/if}
			{#if selection.video}
				<div class="evpop-row">
					<Video size={17} />
					<div class="er-main">
						<a href={selection.video} target="_blank" rel="noreferrer">{selection.video}</a>
					</div>
				</div>
			{/if}
			{#if selection.notes}
				<div class="evpop-row">
					<NotebookPen size={17} />
					<div class="er-main evpop-notes">{selection.notes}</div>
				</div>
			{/if}
			{#if selection.thread}
				<div class="evpop-row">
					<Mail size={17} />
					<div class="er-main">
						{selection.thread}
						<div class="er-sub">Source thread stays attached and encrypted.</div>
					</div>
				</div>
			{/if}
			<div class="evpop-row">
				<CalendarDays size={17} />
				<div class="er-main">
					{selection.calName}
					<div class="er-sub">{selection.organizer}</div>
				</div>
			</div>
			{#if selection.guests}
				<div class="evpop-row">
					<Users size={17} />
					<div class="er-main">
						<div class="evpop-guests">
							{#each selection.guests as guest (guest.name + guest.sub)}
								<div class="evpop-guest">
									<Avatar initials={guest.init} size={26} bg={guest.bg} fg={guest.fg} />
									<span class="eg-tx">
										<span class="eg-nm">{guest.name}</span>
										<span class="gsub">{guest.sub}</span>
									</span>
								</div>
							{/each}
						</div>
					</div>
				</div>
			{/if}
			<DisclosureBoundary
				heading="What leaves this device"
				headingIcon={ShieldCheck}
				lines={selection.boundary}
			/>
			<div class="evpop-row">
				<ClockArrowLeft size={17} />
				<div class="er-main">
					{selection.prov}
					<div class="er-sub">
						{selection.provSub}
						{#if selection.canEdit}
							<button type="button" class="evpop-hist" onclick={history}>History</button>
						{/if}
					</div>
				</div>
			</div>
		</div>
		{#if selection.rsvp}
			<div class="evpop-rsvp">
				{#each RSVP as option (option.value)}
					<button
						type="button"
						class={option.cls}
						class:on={selection.myPartstat === option.value}
						onclick={() => respond(option.value)}
					>
						<option.icon size={14} />{option.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</Popover.Content>
