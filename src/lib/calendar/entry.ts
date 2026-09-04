import type { CalendarEvent } from '$lib/mail/render/icalParse';
import type { Message } from '$lib/mail/data';
import { itemFromInvitation, parseInvitation } from './ics/fromMail';
import { myAddressList } from './invite';
import type { CalendarItem, ItemKind, Partstat } from './model';
import { applyCalendarEvents, applyFromMessageId } from './replies';
import { calendarStore } from './store.svelte';

export interface PendingFromMail {
	kind: ItemKind;
	title: string;
	notes?: string;
	sourceMessageId: string;
	threadSubject: string;
}

const PENDING_KEY = 'thelemail:calendar:pending';

export function stashFromMail(pending: PendingFromMail): void {
	try {
		sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
	} catch {
		return;
	}
}

export function takePending(): PendingFromMail | null {
	try {
		const raw = sessionStorage.getItem(PENDING_KEY);
		if (!raw) return null;
		sessionStorage.removeItem(PENDING_KEY);
		return JSON.parse(raw) as PendingFromMail;
	} catch {
		return null;
	}
}

export interface InvitationStatus {
	added: boolean;
	calendarName?: string;
	itemId?: string;
	partstat?: Partstat;
	loaded: boolean;
}

export async function statusFor(ev: CalendarEvent): Promise<InvitationStatus> {
	await calendarStore.ensureLoaded();
	if (!ev.uid) return { added: false, loaded: calendarStore.loaded };
	const entry = calendarStore.itemByUid(ev.uid);
	if (!entry) return { added: false, loaded: calendarStore.loaded };
	const mine = myAddressList();
	const me = (entry.item.attendees ?? []).find((a) => mine.includes(a.email.toLowerCase()));
	return {
		added: true,
		calendarName: calendarStore.calendar(entry.item.calendarId)?.name,
		itemId: entry.item.id,
		partstat: calendarStore.myState(entry.item.id)?.partstat ?? me?.partstat,
		loaded: true
	};
}

export async function addFromMail(
	ev: CalendarEvent,
	message: Message,
	partstat?: Partstat
): Promise<CalendarItem> {
	await calendarStore.ensureLoaded();
	if (!ev.rawIcs || !ev.uid) throw new Error('This invitation carries no calendar data');
	const existing = calendarStore.itemByUid(ev.uid);
	if (existing) return existing.item;
	const target = calendarStore.defaultCalendar;
	if (!target) throw new Error('No calendar to add it to yet');
	const inv = parseInvitation(ev.rawIcs, myAddressList());
	if (!inv) throw new Error('Could not read the invitation');
	const item = itemFromInvitation(
		inv,
		ev,
		target.id,
		myAddressList(),
		message.id,
		calendarStore.defaultPrivacy(target.id)
	);
	if (partstat) {
		const mine = myAddressList();
		item.attendees = (item.attendees ?? []).map((a) =>
			mine.includes(a.email.toLowerCase()) ? { ...a, partstat } : a
		);
	}
	const saved = await calendarStore.saveItem(item, { label: `Added “${item.title}” from mail` });
	if (partstat) await calendarStore.setMyState(item.id, { partstat }, `Replied ${partstat}`);
	return saved.item;
}

export async function observeMailEvents(events: CalendarEvent[], messageId: string): Promise<void> {
	await calendarStore.ensureLoaded();
	await applyCalendarEvents(events, messageId);
}

export async function observeNewMessage(messageId: string): Promise<void> {
	await applyFromMessageId(messageId);
}
