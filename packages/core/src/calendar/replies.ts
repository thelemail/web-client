import { getMessage } from '$core/api/messages';
import { decryptPreview } from '$core/mail/decrypt';
import { loadMessageBody } from '$core/mail/bodySource';
import type { CalendarEvent } from '$core/mail/render/icalParse';
import { auth } from '$core/stores/auth.svelte';
import { parseInvitation, type ParsedInvitation } from './ics/fromMail';
import { isOrganizer, myAddressList } from './invite';
import type { CalendarItem } from './model';
import { calendarStore } from './store.svelte';

export type AppliedChange =
	| { kind: 'reply'; itemId: string; email: string; partstat: string }
	| { kind: 'cancel'; itemId: string; occurrence: string | null }
	| { kind: 'update'; itemId: string }
	| { kind: 'ignored'; reason: string };

const handled = new Set<string>();

async function applyReply(
	inv: ParsedInvitation,
	entry: { item: CalendarItem }
): Promise<AppliedChange> {
	const item = entry.item;
	if (!isOrganizer(item)) return { kind: 'ignored', reason: 'not the organiser' };
	if (inv.sequence < item.sequence) return { kind: 'ignored', reason: 'stale sequence' };
	const replying = inv.attendees[0];
	if (!replying) return { kind: 'ignored', reason: 'no attendee in reply' };
	const email = replying.email.toLowerCase();
	const current = (item.attendees ?? []).find((a) => a.email.toLowerCase() === email);
	if (current && current.partstat === replying.partstat) {
		return { kind: 'ignored', reason: 'already applied' };
	}
	const attendees = (item.attendees ?? []).map((a) =>
		a.email.toLowerCase() === email
			? { ...a, partstat: replying.partstat, name: a.name ?? replying.name }
			: a
	);
	if (!attendees.some((a) => a.email.toLowerCase() === email)) {
		attendees.push({ ...replying, internal: replying.internal });
	}
	await calendarStore.saveItem(
		{ ...item, attendees },
		{
			fields: ['partstat'],
			label: `${replying.name ?? replying.email} replied ${replying.partstat}`
		}
	);
	return { kind: 'reply', itemId: item.id, email, partstat: replying.partstat };
}

async function applyCancel(
	inv: ParsedInvitation,
	entry: { item: CalendarItem }
): Promise<AppliedChange> {
	const item = entry.item;
	if (isOrganizer(item)) return { kind: 'ignored', reason: 'own cancellation' };
	if (inv.recurrenceId && item.rrule) {
		const next: CalendarItem = {
			...item,
			overrides: { ...(item.overrides ?? {}), [inv.recurrenceId]: { cancelled: true } }
		};
		await calendarStore.saveItem(next, {
			label: `Organiser cancelled one occurrence of “${item.title}”`
		});
		return { kind: 'cancel', itemId: item.id, occurrence: inv.recurrenceId };
	}
	await calendarStore.deleteItem(item.id);
	return { kind: 'cancel', itemId: item.id, occurrence: null };
}

async function applyUpdate(
	inv: ParsedInvitation,
	entry: { item: CalendarItem }
): Promise<AppliedChange> {
	const item = entry.item;
	if (isOrganizer(item)) return { kind: 'ignored', reason: 'own invitation' };
	if (inv.sequence <= item.sequence) return { kind: 'ignored', reason: 'not newer' };
	const mine = myAddressList();
	const next: CalendarItem = {
		...item,
		title: inv.summary || item.title,
		location: inv.location ?? item.location,
		videoUrl: inv.url ?? item.videoUrl,
		notes: inv.description ?? item.notes,
		start: inv.start ?? item.start,
		end: inv.end ?? item.end,
		rrule: inv.rrule,
		exdates: inv.exdates.length ? inv.exdates : undefined,
		attendees: inv.attendees.map((a) => ({
			...a,
			internal: a.internal || mine.includes(a.email.toLowerCase())
		})),
		sequence: inv.sequence
	};
	await calendarStore.saveItem(next, { label: `Organiser updated “${next.title}”` });
	return { kind: 'update', itemId: item.id };
}

export async function applyCalendarEvents(
	events: CalendarEvent[],
	messageId: string
): Promise<AppliedChange[]> {
	const out: AppliedChange[] = [];
	for (const ev of events) {
		if (!ev.rawIcs || !ev.uid) continue;
		const key = `${messageId}:${ev.uid}:${ev.method ?? ''}`;
		if (handled.has(key)) continue;
		const inv = parseInvitation(ev.rawIcs, myAddressList());
		if (!inv) continue;
		const entry = calendarStore.itemByUid(inv.uid);
		if (!entry) continue;
		let result: AppliedChange;
		try {
			if (inv.method === 'REPLY') result = await applyReply(inv, entry);
			else if (inv.method === 'CANCEL' || inv.cancelled) result = await applyCancel(inv, entry);
			else if (inv.method === 'REQUEST') result = await applyUpdate(inv, entry);
			else result = { kind: 'ignored', reason: inv.method || 'no method' };
		} catch (err) {
			result = { kind: 'ignored', reason: err instanceof Error ? err.message : 'failed' };
		}
		if (result.kind !== 'ignored') handled.add(key);
		out.push(result);
	}
	return out;
}

export async function applyFromMessageId(messageId: string): Promise<AppliedChange[]> {
	const accountId = auth.accountId;
	if (!accountId || !calendarStore.loaded) return [];
	const detail = await getMessage(messageId);
	const preview = await decryptPreview(accountId, detail.encryptedPreview);
	const method = preview.flags?.calendar;
	if (typeof method !== 'string' || !['REPLY', 'CANCEL', 'REQUEST'].includes(method)) return [];
	const { render } = await loadMessageBody(accountId, messageId, { stripTracking: true });
	return applyCalendarEvents(render.calendarEvents, messageId);
}
