import { addresses } from '$lib/stores/addresses.svelte';
import { auth } from '$lib/stores/auth.svelte';
import { longWhen } from './format';
import { buildItemIcs, buildReplyIcs, type IcsIdentity } from './ics/write';
import type { Attendee, CalendarItem, Partstat } from './model';
import type { OutboxMail, OutboxRecipient } from './outbox';
import { expandItem, type Occurrence } from './recur';
import { calendarStore } from './store.svelte';

export interface SenderIdentity extends IcsIdentity {
	aliasId?: string;
}

export function myAddressList(): string[] {
	const out = addresses.items.map((a) => a.email.toLowerCase());
	if (auth.email) out.push(auth.email.toLowerCase());
	return out;
}

export function identityFor(item: CalendarItem): SenderIdentity {
	const cal = calendarStore.calendar(item.calendarId);
	if (cal?.kind === 'role' && cal.row.sharedAliasId) {
		const addr = addresses.shared.find((a) => a.sharedAliasId === cal.row.sharedAliasId);
		if (addr)
			return { email: addr.email, name: addr.name ?? undefined, aliasId: cal.row.sharedAliasId };
	}
	if (item.organizer && myAddressList().includes(item.organizer.email.toLowerCase())) {
		const addr = addresses.items.find(
			(a) => a.email.toLowerCase() === item.organizer?.email.toLowerCase()
		);
		return {
			email: item.organizer.email,
			name: item.organizer.name ?? addr?.name ?? auth.fullName ?? undefined,
			aliasId: addr?.sharedAliasId ?? undefined
		};
	}
	const primary = addresses.primary;
	return {
		email: primary?.email ?? auth.email ?? '',
		name: primary?.name ?? auth.fullName ?? undefined
	};
}

export function isOrganizer(item: CalendarItem): boolean {
	if (!item.organizer) return true;
	return myAddressList().includes(item.organizer.email.toLowerCase());
}

function recipientsOf(attendees: Attendee[], exclude: string[]): OutboxRecipient[] {
	const seen = new Set<string>();
	const out: OutboxRecipient[] = [];
	for (const a of attendees) {
		const email = a.email.toLowerCase();
		if (exclude.includes(email) || seen.has(email)) continue;
		seen.add(email);
		out.push({ display: a.name ?? '', address: a.email });
	}
	return out;
}

function whenLine(item: CalendarItem, occurrence?: Occurrence): string {
	if (occurrence) return longWhen(occurrence);
	const first =
		item.start && item.end ? expandItem(item, new Date(0), new Date(8.64e15))[0] : undefined;
	return first ? longWhen(first) : '';
}

export function invitationChanged(previous: CalendarItem | undefined, next: CalendarItem): boolean {
	if (!previous) return true;
	const pick = (i: CalendarItem) =>
		JSON.stringify([
			i.title,
			i.start,
			i.end,
			i.rrule,
			i.exdates,
			i.location,
			i.videoUrl,
			i.overrides,
			(i.attendees ?? []).map((a) => a.email.toLowerCase()).sort()
		]);
	return pick(previous) !== pick(next);
}

export async function sendInvitations(
	item: CalendarItem,
	previous?: CalendarItem,
	occurrence?: Occurrence
): Promise<void> {
	if (item.kind !== 'event' || !isOrganizer(item)) return;
	const identity = identityFor(item);
	const mine = [...myAddressList(), identity.email.toLowerCase()];
	const attendees = item.attendees ?? [];
	const current = recipientsOf(attendees, mine);
	const removed = recipientsOf(
		(previous?.attendees ?? []).filter(
			(a) => !attendees.some((b) => b.email.toLowerCase() === a.email.toLowerCase())
		),
		mine
	);
	const when = whenLine(item, occurrence);
	if (current.length) {
		const ics = buildItemIcs(item, {
			method: 'REQUEST',
			organizer: identity,
			attendees,
			occurrence
		});
		const verb = previous ? 'Updated invitation' : 'Invitation';
		await calendarStore.queueMail(
			item.id,
			{
				to: current,
				subject: `${verb}: ${item.title || '(untitled)'}${when ? ` @ ${when}` : ''}`.slice(0, 200),
				body: `${identity.name ?? identity.email} ${previous ? 'updated' : 'invited you to'} "${item.title || '(untitled)'}"${when ? ` on ${when}` : ''}.`,
				ics,
				method: 'REQUEST',
				fromEmail: identity.email,
				fromName: identity.name,
				fromAliasId: identity.aliasId
			},
			`${verb} · ${item.title || 'untitled'}`
		);
	}
	if (removed.length && previous) {
		const ics = buildItemIcs(previous, {
			method: 'CANCEL',
			organizer: identity,
			attendees: previous.attendees ?? []
		});
		await calendarStore.queueMail(
			item.id,
			{
				to: removed,
				subject: `Cancelled: ${previous.title || '(untitled)'}`.slice(0, 200),
				body: `${identity.name ?? identity.email} removed you from "${previous.title || '(untitled)'}".`,
				ics,
				method: 'CANCEL',
				fromEmail: identity.email,
				fromName: identity.name,
				fromAliasId: identity.aliasId
			},
			`Cancellation · ${previous.title || 'untitled'}`
		);
	}
}

export async function sendCancellation(item: CalendarItem, occurrence?: Occurrence): Promise<void> {
	if (item.kind !== 'event' || !isOrganizer(item)) return;
	const identity = identityFor(item);
	const mine = [...myAddressList(), identity.email.toLowerCase()];
	const to = recipientsOf(item.attendees ?? [], mine);
	if (!to.length) return;
	const cancelled: CalendarItem = { ...item, sequence: item.sequence + 1 };
	const ics = buildItemIcs(cancelled, {
		method: 'CANCEL',
		organizer: identity,
		attendees: item.attendees ?? [],
		occurrence,
		cancelled: true
	});
	await calendarStore.queueMail(
		item.id,
		{
			to,
			subject:
				`Cancelled: ${item.title || '(untitled)'}${occurrence ? ` @ ${longWhen(occurrence)}` : ''}`.slice(
					0,
					200
				),
			body: `${identity.name ?? identity.email} cancelled "${item.title || '(untitled)'}"${occurrence ? ` on ${longWhen(occurrence)}` : ''}.`,
			ics,
			method: 'CANCEL',
			fromEmail: identity.email,
			fromName: identity.name,
			fromAliasId: identity.aliasId
		},
		`Cancellation · ${item.title || 'untitled'}`
	);
}

const REPLY_SUBJECT: Record<Partstat, string> = {
	accepted: 'Accepted',
	tentative: 'Tentative',
	declined: 'Declined',
	'needs-action': 'Re'
};

export async function sendReply(
	item: CalendarItem,
	partstat: Partstat,
	sourceMessageId?: string
): Promise<void> {
	if (!item.organizer || isOrganizer(item)) return;
	const mine = myAddressList();
	const me = (item.attendees ?? []).find((a) => mine.includes(a.email.toLowerCase()));
	const identity: IcsIdentity = {
		email: me?.email ?? auth.email ?? '',
		name: me?.name ?? auth.fullName ?? undefined
	};
	if (!identity.email) return;
	const ics = buildReplyIcs(item, identity, partstat, item.organizer);
	const mail: OutboxMail = {
		to: [{ display: item.organizer.name ?? '', address: item.organizer.email }],
		subject: `${REPLY_SUBJECT[partstat]}: ${item.title || '(event)'}`.slice(0, 200),
		body:
			partstat === 'accepted'
				? `I will attend "${item.title}".`
				: partstat === 'tentative'
					? `I may attend "${item.title}".`
					: `I am unable to attend "${item.title}".`,
		ics,
		method: 'REPLY',
		inReplyToMessageId: sourceMessageId
	};
	await calendarStore.queueMail(item.id, mail, `RSVP ${partstat} · ${item.title || 'untitled'}`);
}
