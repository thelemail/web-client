<script lang="ts">
	import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
	import Icon from '$core/components/Icon.svelte';
	import {
		faCalendarDays,
		faCheck,
		faCircleExclamation,
		faClockRotateLeft,
		faCopy,
		faEnvelope,
		faLocationDot,
		faNotebook,
		faPenLine,
		faShieldCheck,
		faTrashCan,
		faUsers,
		faVideo,
		faXmark
	} from '@fortawesome/pro-regular-svg-icons';
	import Avatar from '$core/components/Avatar.svelte';
	import * as Popover from '$core/components/ui/popover';
	import { m } from '$paraglide/messages.js';
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

	const RSVP: { value: Partstat; label: () => string; icon: IconDefinition; cls: string }[] = [
		{ value: 'accepted', label: () => m.cal_rsvp_yes(), icon: faCheck, cls: 'yes' },
		{ value: 'tentative', label: () => m.cal_rsvp_maybe(), icon: faCircleExclamation, cls: 'maybe' },
		{ value: 'declined', label: () => m.cal_rsvp_no(), icon: faXmark, cls: 'no' }
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
		cal.notify(m.cal_pop_deleted({ title: selection.title }));
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
			<button type="button" class="evpop-ic" aria-label={m.common_edit()} onclick={edit}>
				<Icon icon={faPenLine} size={17} />
			</button>
			<button type="button" class="evpop-ic" aria-label={m.cal_pop_duplicate_aria()} onclick={duplicate}>
				<Icon icon={faCopy} size={17} />
			</button>
			<button type="button" class="evpop-ic danger" aria-label={m.common_delete()} onclick={remove}>
				<Icon icon={faTrashCan} size={17} />
			</button>
		{/if}
		<button type="button" class="evpop-ic" aria-label={m.common_close()} onclick={onClose}>
			<Icon icon={faXmark} size={17} />
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
					<Icon icon={faLocationDot} size={17} />
					<div class="er-main">{selection.loc}</div>
				</div>
			{/if}
			{#if selection.video}
				<div class="evpop-row">
					<Icon icon={faVideo} size={17} />
					<div class="er-main">
						<a href={selection.video} target="_blank" rel="noreferrer">{selection.video}</a>
					</div>
				</div>
			{/if}
			{#if selection.notes}
				<div class="evpop-row">
					<Icon icon={faNotebook} size={17} />
					<div class="er-main evpop-notes">{selection.notes}</div>
				</div>
			{/if}
			{#if selection.thread}
				<div class="evpop-row">
					<Icon icon={faEnvelope} size={17} />
					<div class="er-main">
						{selection.thread}
						<div class="er-sub">{m.cal_pop_thread_note()}</div>
					</div>
				</div>
			{/if}
			<div class="evpop-row">
				<Icon icon={faCalendarDays} size={17} />
				<div class="er-main">
					{selection.calName}
					<div class="er-sub">{selection.organizer}</div>
				</div>
			</div>
			{#if selection.guests}
				<div class="evpop-row">
					<Icon icon={faUsers} size={17} />
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
				heading={m.cal_boundary_heading_device()}
				headingIcon={faShieldCheck}
				lines={selection.boundary}
			/>
			<div class="evpop-row">
				<Icon icon={faClockRotateLeft} size={17} />
				<div class="er-main">
					{selection.prov}
					<div class="er-sub">
						{selection.provSub}
						{#if selection.canEdit}
							<button type="button" class="evpop-hist" onclick={history}>{m.cal_pop_history()}</button>
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
						<Icon icon={option.icon} size={14} />{option.label()}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</Popover.Content>
