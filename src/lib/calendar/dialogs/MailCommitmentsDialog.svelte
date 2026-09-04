<script lang="ts">
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Clock from '@lucide/svelte/icons/clock';
	import Eye from '@lucide/svelte/icons/eye';
	import Mail from '@lucide/svelte/icons/mail';
	import Paperclip from '@lucide/svelte/icons/paperclip';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Timer from '@lucide/svelte/icons/timer';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import Avatar from '$lib/components/Avatar.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import DisclosureBoundary from '../DisclosureBoundary.svelte';
	import PrivacyChip from '../PrivacyChip.svelte';
	import { CALENDARS, PEOPLE } from '../fixtures';
	import { cal } from '../state.svelte';
	import type { BoundaryLine } from '../types';

	const PROPOSALS = [
		{
			key: 'p1',
			kind: 'Event',
			calendar: 'Family',
			color: CALENDARS.family.color,
			title: 'Museum trip — Jules',
			why: 'One explicit date in the message body, and the class matches Jules on the Family calendar.',
			rows: [
				{ icon: CalendarDays, text: 'Thu 25 June · all day · departs 08:30, returns 17:00' },
				{ icon: Paperclip, text: 'Keeps the message and autorisation-sortie-5eB.pdf' }
			],
			needsOwner: false
		},
		{
			key: 'p2',
			kind: 'Task',
			calendar: 'school@meudon.fr',
			color: CALENDARS.school.color,
			title: 'Return signed consent form',
			why: 'A deadline sentence with no time — 18:00 assumed from the school’s office hours, editable.',
			rows: [
				{ icon: Clock, text: 'Due Wed 17 June, 18:00 · estimate 10 min' },
				{ icon: Timer, text: 'Timeboxed Wed 17:00 if you accept the suggestion' }
			],
			needsOwner: true
		},
		{
			key: 'p3',
			kind: 'Task',
			calendar: 'Family',
			color: CALENDARS.family.color,
			title: 'Pay museum trip fee — €18',
			why: 'An amount and a second, later deadline. Kept separate so one can be done without the other.',
			rows: [
				{ icon: Clock, text: 'Due Mon 22 June · estimate 5 min' },
				{ icon: Undo2, text: 'No payment is set up. This is a reminder only.' }
			],
			needsOwner: false
		}
	];

	const OWNERS = ['marie', 'you'] as const;

	const HOW_READ: BoundaryLine[] = [
		{
			tone: 'yes',
			text: 'Deterministic date, deadline and amount parsing ran locally.',
			mono: 'no cloud call · no model · nothing logged'
		},
		{ tone: 'no', text: 'Nothing is written to a calendar until you confirm below.' }
	];

	const IF_CONFIRMED: BoundaryLine[] = [
		{ tone: 'yes', text: 'Encrypted for the four members of meudon.fr.' },
		{ tone: 'no', text: 'No invitation is sent. The school is not told anything.' },
		{
			tone: 'yes',
			text: 'Reversible in one step for 30 days, with the original message attached.'
		}
	];
</script>

<Dialog.Content class="cal-surface cal-dlg wide" showCloseButton>
	<Dialog.Header class="cal-dlg-h">
		<Mail size={18} color="var(--brass-600)" />
		<Dialog.Title class="dt">Commitments found in this message</Dialog.Title>
		<PrivacyChip tone="private" label="Parsed on this device" />
	</Dialog.Header>

	<div class="split">
		<div class="sp-l">
			<div class="sp-eyebrow">Source message</div>
			<div class="msg-h">
				<div class="msg-sub">Sortie scolaire — Musée de Cluny (consent required)</div>
				<div class="msg-meta">
					<span>secretariat@college-meudon.fr</span>
					<span class="sep">→</span>
					<span class="to">school@meudon.fr</span>
					<span class="sep">·</span>
					<span>Sun 14 Jun, 18:42</span>
				</div>
			</div>
			<div class="msg-body">
				<p>Chers parents,</p>
				<p>
					La classe de 5e B visitera le <mark>Musée de Cluny le jeudi 25 juin</mark>, départ 08:30 du
					collège, retour prévu 17:00. Merci de
					<mark>retourner l’autorisation signée avant le mercredi 17 juin</mark>.
				</p>
				<p>Une participation de <mark>18 €</mark> est demandée, à régler avant le 22 juin.</p>
				<p>Cordialement,<br />Le secrétariat</p>
			</div>
			<div class="msg-att">
				<Paperclip size={17} />
				<span class="fn">autorisation-sortie-5eB.pdf</span>
				<span class="fs">214 KB</span>
			</div>
			<div class="limits">
				<DisclosureBoundary
					heading="How this was read"
					headingIcon={ShieldCheck}
					lines={HOW_READ}
					noIcon="x"
				/>
			</div>
		</div>

		<div class="sp-r">
			<div class="sp-eyebrow">Proposed — {cal.mailSelectedCount} selected</div>
			{#each PROPOSALS as proposal (proposal.key)}
				{@const on = cal.mailSelected[proposal.key]}
				<div class="prop" class:on class:off={!on} style:--c={proposal.color}>
					<Checkbox
						id="prop-{proposal.key}"
						checked={on}
						onCheckedChange={() => cal.toggleMailProposal(proposal.key)}
						class="mt-0.5 size-[18px] rounded-[5px]"
						aria-label={proposal.title}
					/>
					<div class="pr-main">
						<div class="pr-kind"><i></i>{proposal.kind} · {proposal.calendar}</div>
						<div class="pr-t">{proposal.title}</div>
						<div class="pr-rows">
							{#each proposal.rows as row (row.text)}
								<div class="pr-row"><row.icon size={14} /><span>{row.text}</span></div>
							{/each}
						</div>
						<div class="pr-why"><b>Why:</b> {proposal.why}</div>
						{#if proposal.needsOwner}
							<div class="own">
								{#each OWNERS as key (key)}
									{@const person = PEOPLE[key]}
									<button
										type="button"
										class="own-b"
										class:on={cal.mailOwner === key}
										onclick={() => (cal.mailOwner = key)}
									>
										<Avatar initials={person.init} size={21} bg={person.bg} fg={person.fg} />
										{person.name}
									</button>
								{/each}
							</div>
							{#if cal.mailOwnerMissing}
								<div class="own-req">
									<CircleAlert size={13} />A task on a shared address needs one named owner.
								</div>
							{/if}
						{/if}
					</div>
				</div>
			{/each}
			<DisclosureBoundary heading="If you confirm" headingIcon={Eye} lines={IF_CONFIRMED} noIcon="x" />
		</div>
	</div>

	<Dialog.Footer class="cal-dlg-foot">
		<Button variant="secondary" onclick={() => (cal.dialog = null)}>Not now</Button>
		<span class="note">Nothing has changed yet.</span>
		<div class="grow"></div>
		<Button variant="secondary" onclick={() => (cal.dialog = null)}>Edit each first</Button>
		<Button
			variant="primary"
			disabled={cal.mailOwnerMissing || !cal.mailSelectedCount}
			onclick={() => cal.confirmMail()}
		>
			{cal.mailSelectedCount ? `Add ${cal.mailSelectedCount} to the calendar` : 'Nothing selected'}
		</Button>
	</Dialog.Footer>
</Dialog.Content>
