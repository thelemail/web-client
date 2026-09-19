import X from '@lucide/svelte/icons/x';
import { initialsFor } from '$core/mail/initials';
import { paletteFor } from '$core/mail/avatarPalette';
import { m } from '$paraglide/messages.js';
import { longWhen } from './format';
import type { Occurrence } from './recur';
import type { CalendarView } from './store.svelte';
import type { BoundaryLine, GuestChip, Selection } from './types';
import type { Attendee, CalendarItem, ItemKind, MemberState, Partstat } from './model';
import { isOwnRecipient } from '$core/mail/recipientAddress';
import { i18n } from '$core/i18n/locale.svelte';

const KIND_LABEL: Record<ItemKind, () => string> = {
	event: () => m.cal_kind_event(),
	task: () => m.cal_kind_task(),
	hold: () => m.cal_kind_hold()
};

const PARTSTAT_LABEL: Record<Partstat, () => string> = {
	'needs-action': () => m.cal_partstat_needs_action(),
	accepted: () => m.cal_partstat_accepted(),
	tentative: () => m.cal_partstat_tentative(),
	declined: () => m.cal_partstat_declined()
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
	const calName = ctx.calendar?.name ?? m.cal_desc_this_calendar();
	if (item.kind === 'hold') {
		return [
			{
				tone: 'yes',
				text: m.cal_desc_hold_line(),
				mono: item.privacy === 'private' ? m.cal_desc_server_nothing() : m.cal_desc_server_busy_shared()
			},
			{ tone: 'no', text: m.cal_desc_hold_no_leak() }
		];
	}
	const lines: BoundaryLine[] = [];
	const external = externalAttendees(item);
	if (external.length) {
		lines.push({
			tone: 'warn',
			text: m.cal_desc_external_guests({ count: external.length }),
			mono: m.cal_desc_external_mono({ emails: external.map((a) => a.email).join(', ') })
		});
		lines.push({
			tone: 'yes',
			text: m.cal_desc_notes_stay()
		});
		if (ctx.calendar?.kind === 'role' && item.organizer) {
			lines.push({
				tone: 'yes',
				text: m.cal_desc_role_identity(),
				mono: m.cal_desc_from({ email: item.organizer.email })
			});
		}
	} else {
		lines.push({
			tone: 'yes',
			text:
				ctx.calendar?.kind === 'personal'
					? m.cal_desc_encrypted_own()
					: m.cal_desc_encrypted_members({ calendar: calName }),
			mono: m.cal_desc_zero_access_mono()
		});
	}
	if (item.privacy === 'private') {
		lines.push({ tone: 'no', text: m.cal_desc_private_none() });
	} else {
		lines.push({
			tone: 'warn',
			text: m.cal_desc_busy_published(),
			mono: m.cal_desc_server_start_end()
		});
	}
	if ((item.attendees ?? []).length) {
		lines.push({
			tone: 'no',
			icon: X,
			text: m.cal_desc_envelope()
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
		const status = PARTSTAT_LABEL[a.partstat]();
		return {
			init: initialsFor(name, a.email),
			name,
			sub: a.internal
				? m.cal_desc_guest_internal({ email: a.email, status })
				: m.cal_desc_guest_external({ email: a.email, status }),
			bg: pal.bg,
			fg: pal.fg,
			partstat: a.partstat
		};
	});
}

function organizerLine(item: CalendarItem, ctx: DescribeContext): string {
	if (item.kind === 'task') {
		const owner = item.owner?.name || item.owner?.email;
		const parts = [owner ? m.cal_desc_owner({ owner }) : m.cal_desc_needs_owner()];
		if (item.due)
			parts.push(
				m.cal_desc_due({
					date: 'date' in item.due ? item.due.date : item.due.dateTime.slice(0, 16).replace('T', ' ')
				})
			);
		if (item.estimateMinutes) parts.push(m.cal_desc_estimate({ minutes: item.estimateMinutes }));
		return parts.join(' · ');
	}
	if (!item.organizer || isMine(item, ctx.myAddresses)) return m.cal_desc_you_organise();
	const name =
		item.organizer.name ||
		ctx.memberNames.get(item.organizer.email.toLowerCase()) ||
		item.organizer.email;
	return m.cal_desc_organised_by({ name });
}

function myPartstat(item: CalendarItem, ctx: DescribeContext): Partstat | null {
	const mine = (item.attendees ?? []).find((a) => isOwnRecipient(a.email, ctx.myAddresses));
	return ctx.myState?.partstat ?? mine?.partstat ?? null;
}

export function describeOccurrence(occ: Occurrence, ctx: DescribeContext): Selection {
	const item = occ.item;
	const external = externalAttendees(item).length > 0;
	const editable = !!ctx.calendar?.canWrite && isMine(item, ctx.myAddresses);
	const invited = !isMine(item, ctx.myAddresses) && item.kind === 'event';
	const provSub = ctx.pending
		? ctx.offline
			? m.cal_desc_saved_waiting()
			: m.cal_desc_saving()
		: m.cal_desc_revision({ rev: ctx.rev, when: new Date(ctx.updatedAt).toLocaleString(i18n.tag) });
	const when = longWhen(occ);
	return {
		title: item.kind === 'hold' ? m.cal_busy() : occ.title || m.cal_untitled(),
		whenLong:
			item.kind === 'task'
				? m.cal_desc_timeboxed({ when })
				: occ.patched
					? m.cal_desc_occurrence_differs({ when })
					: when,
		loc: occ.location ?? null,
		video: occ.videoUrl ?? null,
		notes: item.kind === 'hold' ? null : (occ.notes ?? null),
		thread: item.threadSubject ?? null,
		calName: m.cal_desc_kind_on({
			kind: KIND_LABEL[item.kind](),
			calendar: ctx.calendar?.name ?? m.cal_desc_calendar_fallback()
		}),
		organizer: organizerLine(item, ctx),
		guests: guestChips(item, ctx),
		boundary: boundaryFor(item, ctx),
		prov: external || invited ? m.cal_desc_organiser_record() : m.cal_desc_zero_access(),
		provSub,
		rsvp: invited,
		myPartstat: myPartstat(item, ctx),
		color: ctx.calendar?.color ?? '#2E5440',
		canEdit: editable || (!!ctx.calendar?.canWrite && !invited),
		occ
	};
}
