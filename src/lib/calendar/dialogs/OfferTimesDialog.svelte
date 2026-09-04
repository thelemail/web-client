<script lang="ts">
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Check from '@lucide/svelte/icons/check';
	import Eye from '@lucide/svelte/icons/eye';
	import Info from '@lucide/svelte/icons/info';
	import Link2 from '@lucide/svelte/icons/link-2';
	import X from '@lucide/svelte/icons/x';
	import Avatar from '$lib/components/Avatar.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import DisclosureBoundary from '../DisclosureBoundary.svelte';
	import PrivacyChip from '../PrivacyChip.svelte';
	import { SLOTS } from '../fixtures';
	import { cal } from '../state.svelte';
	import type { BoundaryLine } from '../types';

	const why = $derived<BoundaryLine[]>(
		[
			{
				tone: 'yes',
				text: 'Inside your working hours on Thélème Co, after a 15-minute turnaround buffer.'
			},
			...(cal.hasTightSlot
				? [
						{
							tone: 'warn' as const,
							text: 'Friday 13:30 sits 90 minutes after the DNS migration window. Kept, flagged tight.'
						}
					]
				: []),
			{ tone: 'no', text: 'Holds and family events were treated as busy but never read for content.' }
		] as BoundaryLine[]
	);

	const disclosure = $derived<BoundaryLine[]>([
		{
			tone: 'yes',
			text: cal.slotDisclosure,
			mono: 'from: bookings@thelema.co (alias-aware organiser)'
		},
		{ tone: 'no', text: 'Not your other events, their titles, guests, or how full the day is.' },
		{ tone: 'no', text: 'No Thelemail account required to answer. One click, no login.' }
	]);

	const pollColumns = $derived(cal.pollColumns.length || 1);
</script>

<Dialog.Content class="cal-surface cal-dlg wide" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		<CalendarClock size={18} color="var(--brass-600)" />
		<Dialog.Title class="dt">Offer times — reply to R. Panurge</Dialog.Title>
		<PrivacyChip tone="external" label="Leaves Thelemail" />
	</Dialog.Header>

	<div class="split">
		<div class="sp-l">
			<div class="sp-eyebrow">Candidate times</div>
			<div class="slot-list">
				{#each cal.offeredSlots as index (index)}
					<div class="slot">
						<div class="sl-when">
							{SLOTS[index].when}<span class="mono">{SLOTS[index].mono}</span>
						</div>
						<span class="sl-tag" class:tight={SLOTS[index].tight}>{SLOTS[index].tag}</span>
						<button
							type="button"
							class="sl-x"
							aria-label="Drop {SLOTS[index].when}"
							onclick={() => cal.dropSlot(index)}
						>
							<X size={15} />
						</button>
					</div>
				{/each}
			</div>
			<Button variant="secondary" block class="mt-3" onclick={() => cal.addSlot()}>
				Suggest another from free time
			</Button>
			<div class="limits">
				<DisclosureBoundary heading={cal.whyHeading} headingIcon={Info} lines={why} noIcon="x" />
			</div>
		</div>

		<div class="sp-r">
			<div class="sp-eyebrow">What Panurge receives</div>
			<div class="reply">
				<div class="rq">“Happy to talk through the studio migration — when suits you?”</div>
				<p>Any of these work for me:</p>
				<div class="rblock">
					<div class="rh">Thelemail · one-use availability link</div>
					{#each cal.offeredSlots as index (index)}
						<div class="rl"><Check size={13} />{SLOTS[index].when}</div>
					{/each}
					<div class="rl link"><Link2 size={13} />thelema.co/t/8kq2 · expires in 7 days</div>
				</div>
			</div>

			<DisclosureBoundary heading="Disclosure boundary" headingIcon={Eye} lines={disclosure} />

			<div class="sp-eyebrow">Once answers come back</div>
			<div class="poll" style:--poll-cols={pollColumns}>
				<div class="poll-r h">
					<div>Invitee</div>
					{#each cal.pollColumns as column (column.index)}
						<div class="pc">{column.label}</div>
					{/each}
				</div>
				{#each cal.pollRows as row (row.key)}
					<div class="poll-r best">
						<div class="who">
							<Avatar initials={row.init} size={22} bg={row.bg} fg={row.fg} />
							{row.name}
							{#if row.external}<span class="ext">external</span>{/if}
						</div>
						{#each row.cells as cell (cell.index)}
							<div class="pc" class:yes={cell.yes} class:no={!cell.yes}>
								{#if cell.yes}<Check size={15} />{:else}<X size={15} />{/if}
							</div>
						{/each}
					</div>
				{/each}
			</div>
			<div class="poll-note">{cal.pollNote}</div>
		</div>
	</div>

	<Dialog.Footer class="cal-dlg-foot">
		<Button variant="secondary" onclick={() => (cal.dialog = null)}>Cancel</Button>
		<div class="grow"></div>
		<Button variant="secondary" onclick={() => (cal.dialog = null)}>Hold all three for me</Button>
		<Button variant="primary" onclick={() => cal.confirmOffer()}>Insert into reply</Button>
	</Dialog.Footer>
</Dialog.Content>
