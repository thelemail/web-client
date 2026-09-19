<script lang="ts">
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Check from '@lucide/svelte/icons/check';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Info from '@lucide/svelte/icons/info';
	import Link2 from '@lucide/svelte/icons/link-2';
	import X from '@lucide/svelte/icons/x';
	import Avatar from '$core/components/Avatar.svelte';
	import { Button } from '$core/components/ui/button';
	import * as Dialog from '$core/components/ui/dialog';
	import { m } from '$paraglide/messages.js';
	import DisclosureBoundary from '../../DisclosureBoundary.svelte';
	import PrivacyChip from '../../PrivacyChip.svelte';
	import { SLOTS } from '../fixtures';
	import { cal } from '../state.svelte';
	import type { BoundaryLine } from '../../types';

	const why = $derived<BoundaryLine[]>(
		[
			{
				tone: 'yes',
				text: m.cal_offer_why_hours()
			},
			...(cal.hasTightSlot
				? [
						{
							tone: 'warn' as const,
							text: m.cal_offer_why_tight()
						}
					]
				: []),
			{ tone: 'no', text: m.cal_offer_why_holds() }
		] as BoundaryLine[]
	);

	const disclosure = $derived<BoundaryLine[]>([
		{
			tone: 'yes',
			text: cal.slotDisclosure,
			mono: m.cal_offer_disclosure_from({ email: 'bookings@thelema.co' })
		},
		{ tone: 'no', icon: EyeOff, text: m.cal_offer_disclosure_events() },
		{ tone: 'no', icon: UserPlus, text: m.cal_offer_disclosure_account() }
	]);

	const pollColumns = $derived(cal.pollColumns.length || 1);
</script>

<Dialog.Content class="cal-surface cal-dlg wide" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		<CalendarClock size={18} color="var(--brass-600)" />
		<Dialog.Title class="dt">{m.cal_offer_title({ name: 'R. Panurge' })}</Dialog.Title>
		<PrivacyChip tone="external" label={m.cal_offer_leaves()} />
	</Dialog.Header>

	<div class="split">
		<div class="sp-l">
			<div class="sp-eyebrow">{m.cal_offer_candidates()}</div>
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
							aria-label={m.cal_offer_drop_aria({ when: SLOTS[index].when })}
							onclick={() => cal.dropSlot(index)}
						>
							<X size={15} />
						</button>
					</div>
				{/each}
			</div>
			<Button variant="secondary" block class="mt-3" onclick={() => cal.addSlot()}>
				{m.cal_offer_suggest_more()}
			</Button>
			<div class="limits">
				<DisclosureBoundary heading={cal.whyHeading} headingIcon={Info} lines={why} noIcon="x" />
			</div>
		</div>

		<div class="sp-r">
			<div class="sp-eyebrow">{m.cal_offer_receives({ name: 'Panurge' })}</div>
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

			<DisclosureBoundary heading={m.cal_offer_disclosure_heading()} headingIcon={Eye} lines={disclosure} />

			<div class="sp-eyebrow">{m.cal_offer_answers()}</div>
			<div class="poll" style:--poll-cols={pollColumns}>
				<div class="poll-r h">
					<div>{m.cal_offer_invitee()}</div>
					{#each cal.pollColumns as column (column.index)}
						<div class="pc">{column.label}</div>
					{/each}
				</div>
				{#each cal.pollRows as row (row.key)}
					<div class="poll-r best">
						<div class="who">
							<Avatar initials={row.init} size={22} bg={row.bg} fg={row.fg} />
							<span class="pn">{row.name}</span>
							{#if row.external}<span class="ext">{m.cal_offer_external()}</span>{/if}
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
		<Button variant="secondary" onclick={() => (cal.dialog = null)}>{m.common_cancel()}</Button>
		<div class="grow"></div>
		<Button variant="secondary" onclick={() => (cal.dialog = null)}>{m.cal_offer_hold_all()}</Button>
		<Button variant="primary" onclick={() => cal.confirmOffer()}>{m.cal_offer_insert()}</Button>
	</Dialog.Footer>
</Dialog.Content>
