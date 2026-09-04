<script lang="ts">
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import ClockArrowLeft from '@lucide/svelte/icons/clock-arrow-left';
	import Copy from '@lucide/svelte/icons/copy';
	import Mail from '@lucide/svelte/icons/mail';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import PenLine from '@lucide/svelte/icons/pen-line';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';
	import Avatar from '$lib/components/Avatar.svelte';
	import * as Popover from '$lib/components/ui/popover';
	import DisclosureBoundary from './DisclosureBoundary.svelte';
	import { cal } from './state.svelte';
	import type { Selection } from './types';

	interface Props {
		selection: Selection;
		onClose: () => void;
	}

	let { selection, onClose }: Props = $props();

	const RSVP = [
		{ value: 'yes', label: 'Yes', icon: Check },
		{ value: 'maybe', label: 'Maybe', icon: CircleAlert },
		{ value: 'no', label: 'No', icon: X }
	] as const;
</script>

<Popover.Content class="cal-surface cal-pop" align="start" side="right" sideOffset={10}>
	<div class="evpop-top">
		<div class="grow"></div>
		<button type="button" class="evpop-ic" aria-label="Edit" onclick={() => cal.unbuilt()}>
			<PenLine size={17} />
		</button>
		<button type="button" class="evpop-ic" aria-label="Duplicate" onclick={() => cal.unbuilt()}>
			<Copy size={17} />
		</button>
		<button type="button" class="evpop-ic danger" aria-label="Delete" onclick={() => cal.unbuilt()}>
			<Trash2 size={17} />
		</button>
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
				<div class="evpop-row"><MapPin size={17} /><div class="er-main">{selection.loc}</div></div>
			{/if}
			{#if selection.thread}
				<div class="evpop-row">
					<Mail size={17} />
					<div class="er-main">
						{selection.thread}
						<div class="er-sub">
							Source thread stays attached. Opening it does not re-run extraction.
						</div>
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
							{#each selection.guests as guest (guest.name)}
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
					<div class="er-sub">{selection.provSub}</div>
				</div>
			</div>
		</div>
		{#if selection.rsvp}
			<div class="evpop-rsvp">
				{#each RSVP as option (option.value)}
					<button
						type="button"
						class={option.value}
						class:on={cal.rsvp === option.value}
						onclick={() => cal.setRsvp(option.value)}
					>
						<option.icon size={14} />{option.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</Popover.Content>
