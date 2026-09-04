import X from '@lucide/svelte/icons/x';
import { initialsFor } from '$lib/mail/initials';
import { paletteFor } from '$lib/mail/avatarPalette';
import { longWhen } from './format';
import type { Occurrence } from './recur';
import type { CalendarView } from './store.svelte';
import type { BoundaryLine, GuestChip, Selection } from './types';
import type { Attendee, CalendarItem, ItemKind, MemberState, Partstat } from './model';

const KIND_LABEL: Record<ItemKind, string> = {
	event: 'Event',
	task: 'Task',
	hold: 'Hold'
};

const PARTSTAT_LABEL: Record<Partstat, string> = {
	'needs-action': 'no reply yet',
	accepted: 'going',
	tentative: 'maybe',
	declined: 'not going'
};

export interface DescribeContext {
	calendar: CalendarView | undefined;
	myAddresses: string[];
	myState: MemberState | undefined;
	memberNames: Map<string, string>;
	offline: boolean;
	pending: boolean;
	rev: number;
	updatedAt: string;
}

function isMine(item: CalendarItem, myAddresses: string[]): boolean {
	if (!item.organizer) return true;
	return myAddresses.includes(item.organizer.email.toLowerCase());
}

function externalAttendees(item: CalendarItem): Attendee[] {
	return (item.attendees ?? []).filter((a) => !a.internal);
}

function boundaryFor(item: CalendarItem, ctx: DescribeContext): BoundaryLine[] {
	const calName = ctx.calendar?.name ?? 'this calendar';
	if (item.kind === 'hold') {
		return [
			{
				tone: 'yes',
				text: 'A busy window only. This device holds the title; the server never had one.',
				mono:
					item.privacy === 'private'
						? 'server reads: nothing'
						: 'server reads: start, end · shared with your workspace as busy'
			},
			{ tone: 'no', text: 'No location, guests or notes exist to leak.' }
		];
	}
	const lines: BoundaryLine[] = [];
	const external = externalAttendees(item);
	if (external.length) {
		lines.push({
			tone: 'warn',
			text: `Sending title, time and location to ${external.length === 1 ? 'one guest' : `${external.length} guests`} outside your workspace.`,
			mono: `${external.map((a) => a.email).join(', ')} · sealed for Thelemail guests, plain iTIP elsewhere`
		});
		lines.push({
			tone: 'yes',
			text: 'Notes and the source thread stay encrypted and are not attached.'
		});
		if (ctx.calendar?.kind === 'role' && item.organizer) {
			lines.push({
				tone: 'yes',
				text: 'Organiser identity is the role address, not your personal one.',
				mono: `from: ${item.organizer.email}`
			});
		}
	} else {
		lines.push({
			tone: 'yes',
			text:
				ctx.calendar?.kind === 'personal'
					? 'Encrypted to your own key. Reminders fire on your devices.'
					: `Encrypted for ${calName} members. Reminders fire on your devices.`,
			mono: 'zero-access at rest · title, notes, guests'
		});
	}
	if (item.privacy === 'private') {
		lines.push({ tone: 'no', text: 'No availability is published from this item.' });
	} else {
		lines.push({
			tone: 'warn',
			text: 'Busy windows are published to your workspace so others can find a free slot.',
			mono: 'server reads: start, end'
		});
	}
	if ((item.attendees ?? []).length) {
		lines.push({
			tone: 'no',
			icon: X,
			text: 'Envelope metadata for invitations is visible, as with any mail.'
		});
	}
	return lines;
}

function guestChips(item: CalendarItem, ctx: DescribeContext): GuestChip[] | null {
	const guests = item.attendees ?? [];
	if (!guests.length) return null;
	return guests.map((a) => {
		const email = a.email.toLowerCase();
		const name = a.name || ctx.memberNames.get(email) || a.email;
		const pal = paletteFor(email);
		const status = PARTSTAT_LABEL[a.partstat];
		return {
			init: initialsFor(name, a.email),
			name,
			sub: a.internal ? `${a.email} · ${status}` : `${a.email} · external, ${status}`,
			bg: pal.bg,
			fg: pal.fg,
			partstat: a.partstat
		};
	});
}

function organizerLine(item: CalendarItem, ctx: DescribeContext): string {
	if (item.kind === 'task') {
		const owner = item.owner?.name || item.owner?.email;
		const parts = [owner ? `Owner: ${owner}` : 'Needs an owner'];
		if (item.due)
			parts.push(
				`due ${'date' in item.due ? item.due.date : item.due.dateTime.slice(0, 16).replace('T', ' ')}`
			);
		if (item.estimateMinutes) parts.push(`${item.estimateMinutes} min`);
		return parts.join(' · ');
	}
	if (!item.organizer || isMine(item, ctx.myAddresses)) return 'You are the organiser';
	const name =
		item.organizer.name ||
		ctx.memberNames.get(item.organizer.email.toLowerCase()) ||
		item.organizer.email;
	return `Organised by ${name}`;
}

function myPartstat(item: CalendarItem, ctx: DescribeContext): Partstat | null {
	const mine = (item.attendees ?? []).find((a) => ctx.myAddresses.includes(a.email.toLowerCase()));
	return ctx.myState?.partstat ?? mine?.partstat ?? null;
}

export function describeOccurrence(occ: Occurrence, ctx: DescribeContext): Selection {
	const item = occ.item;
	const external = externalAttendees(item).length > 0;
	const editable = !!ctx.calendar?.canWrite && isMine(item, ctx.myAddresses);
	const invited = !isMine(item, ctx.myAddresses) && item.kind === 'event';
	const provSub = ctx.pending
		? ctx.offline
			? 'Saved on this device · waiting to sync'
			: 'Saving…'
		: `Revision ${ctx.rev} · last edited ${new Date(ctx.updatedAt).toLocaleString()} · history kept`;
	return {
		title: item.kind === 'hold' ? 'Busy' : occ.title || '(untitled)',
		whenLong:
			longWhen(occ) +
			(item.kind === 'task' ? ' · timeboxed' : occ.patched ? ' · this occurrence differs' : ''),
		loc: occ.location ?? null,
		video: occ.videoUrl ?? null,
		notes: item.kind === 'hold' ? null : (occ.notes ?? null),
		thread: item.threadSubject ?? null,
		calName: `${KIND_LABEL[item.kind]} on ${ctx.calendar?.name ?? 'calendar'}`,
		organizer: organizerLine(item, ctx),
		guests: guestChips(item, ctx),
		boundary: boundaryFor(item, ctx),
		prov:
			external || invited ? 'Organiser of record: Thelemail' : 'Thelemail · zero-access storage',
		provSub,
		rsvp: invited,
		myPartstat: myPartstat(item, ctx),
		color: ctx.calendar?.color ?? '#2E5440',
		canEdit: editable || (!!ctx.calendar?.canWrite && !invited),
		occ
	};
}
