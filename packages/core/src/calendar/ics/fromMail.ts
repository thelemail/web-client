import ICAL from 'ical.js';
import type { CalendarEvent } from '$core/mail/render/icalParse';
import {
	ITEM_SCHEMA_VERSION,
	normalizeWall,
	type Attendee,
	type CalendarItem,
	type Partstat,
	type Reminder,
	type WhenValue
} from '../model';
import { deviceTimeZone, instantToWall } from '../tz';

const PARTSTAT_IN: Record<string, Partstat> = {
	ACCEPTED: 'accepted',
	TENTATIVE: 'tentative',
	DECLINED: 'declined',
	'NEEDS-ACTION': 'needs-action'
};

function whenFromIcal(t: ICAL.Time, fallbackZone: string): WhenValue {
	if (t.isDate) return { date: t.toString().slice(0, 10) };
	const zoneId = t.zone?.tzid;
	if (zoneId === 'UTC' || zoneId === 'Z') {
		return { dateTime: instantToWall(t.toJSDate(), fallbackZone), timeZone: fallbackZone };
	}
	const wall = normalizeWall(t.toString().slice(0, 19));
	if (zoneId && zoneId !== 'floating') return { dateTime: wall, timeZone: zoneId };
	return { dateTime: wall };
}

function mailto(v: string): string {
	return v
		.replace(/^mailto:/i, '')
		.trim()
		.toLowerCase();
}

export interface ParsedInvitation {
	uid: string;
	method: string;
	sequence: number;
	summary: string;
	description?: string;
	location?: string;
	url?: string;
	start?: WhenValue;
	end?: WhenValue;
	rrule?: string;
	exdates: string[];
	organizer?: { email: string; name?: string };
	attendees: Attendee[];
	reminders: Reminder[];
	recurrenceId?: string;
	cancelled: boolean;
}

export function parseInvitation(rawIcs: string, myAddresses: string[]): ParsedInvitation | null {
	let root: ICAL.Component;
	try {
		root = new ICAL.Component(ICAL.parse(rawIcs));
	} catch {
		return null;
	}
	const events = root.getAllSubcomponents('vevent');
	if (!events.length) return null;
	const master = events.find((e) => !e.hasProperty('recurrence-id')) ?? events[0];
	const zone = deviceTimeZone();
	const uid = String(master.getFirstPropertyValue('uid') ?? '');
	if (!uid) return null;
	const dtstart = master.getFirstPropertyValue('dtstart');
	const dtend = master.getFirstPropertyValue('dtend');
	const duration = master.getFirstPropertyValue('duration');
	let start: WhenValue | undefined;
	let end: WhenValue | undefined;
	if (dtstart instanceof ICAL.Time) {
		start = whenFromIcal(dtstart, zone);
		if (dtend instanceof ICAL.Time) {
			end = whenFromIcal(dtend, zone);
		} else if (duration instanceof ICAL.Duration) {
			const e = dtstart.clone();
			e.addDuration(duration);
			end = whenFromIcal(e, zone);
		} else if (dtstart.isDate) {
			const e = dtstart.clone();
			e.adjust(1, 0, 0, 0);
			end = whenFromIcal(e, zone);
		} else {
			end = start;
		}
	}
	const rrule = master.getFirstPropertyValue('rrule');
	const exdates: string[] = [];
	for (const prop of master.getAllProperties('exdate')) {
		for (const v of prop.getValues() as ICAL.Time[]) {
			const w = whenFromIcal(v, zone);
			exdates.push('date' in w ? w.date : w.dateTime);
		}
	}
	const organizerProp = master.getFirstProperty('organizer');
	const organizer = organizerProp
		? {
				email: mailto(String(organizerProp.getFirstValue())),
				name: organizerProp.getParameter('cn') as string | undefined
			}
		: undefined;
	const attendees: Attendee[] = master.getAllProperties('attendee').map((p) => {
		const email = mailto(String(p.getFirstValue()));
		const partstat = String(p.getParameter('partstat') ?? 'NEEDS-ACTION').toUpperCase();
		const role = String(p.getParameter('role') ?? '').toUpperCase();
		return {
			email,
			name: (p.getParameter('cn') as string | undefined) || undefined,
			partstat: PARTSTAT_IN[partstat] ?? 'needs-action',
			role: role === 'OPT-PARTICIPANT' ? 'opt' : 'req',
			internal: myAddresses.includes(email)
		};
	});
	const reminders: Reminder[] = [];
	for (const alarm of master.getAllSubcomponents('valarm')) {
		const trigger = alarm.getFirstPropertyValue('trigger');
		if (trigger instanceof ICAL.Duration) {
			const minutes = Math.round(-trigger.toSeconds() / 60);
			if (minutes >= 0) reminders.push({ minutesBefore: minutes });
		}
	}
	const rid = master.getFirstPropertyValue('recurrence-id');
	const status = String(master.getFirstPropertyValue('status') ?? '').toUpperCase();
	return {
		uid,
		method: String(root.getFirstPropertyValue('method') ?? '').toUpperCase(),
		sequence: Number(master.getFirstPropertyValue('sequence') ?? 0) || 0,
		summary: String(master.getFirstPropertyValue('summary') ?? ''),
		description: (master.getFirstPropertyValue('description') as string | null) ?? undefined,
		location: (master.getFirstPropertyValue('location') as string | null) ?? undefined,
		url: (master.getFirstPropertyValue('url') as string | null) ?? undefined,
		start,
		end,
		rrule: rrule ? String(rrule) : undefined,
		exdates,
		organizer,
		attendees,
		reminders,
		recurrenceId:
			rid instanceof ICAL.Time
				? 'date' in whenFromIcal(rid, zone)
					? rid.toString().slice(0, 10)
					: normalizeWall(rid.toString().slice(0, 19))
				: undefined,
		cancelled: status === 'CANCELLED'
	};
}

export function itemFromInvitation(
	inv: ParsedInvitation,
	ev: CalendarEvent,
	calendarId: string,
	myAddresses: string[],
	sourceMessageId: string,
	privacy: CalendarItem['privacy'],
	defaultReminderMinutes: number | null
): CalendarItem {
	const now = new Date().toISOString();
	const attendees = inv.attendees.length
		? inv.attendees
		: ev.attendees.map((email) => ({
				email: email.toLowerCase(),
				name: ev.attendeeNames?.[email],
				partstat: 'needs-action' as Partstat,
				role: 'req' as const,
				internal: myAddresses.includes(email.toLowerCase())
			}));
	return {
		schemaVersion: ITEM_SCHEMA_VERSION,
		id: crypto.randomUUID(),
		kind: 'event',
		calendarId,
		title: inv.summary || ev.summary || '(untitled)',
		notes: inv.description ?? ev.description,
		location: inv.location ?? ev.location,
		videoUrl: inv.url,
		start: inv.start,
		end: inv.end,
		rrule: inv.rrule,
		exdates: inv.exdates.length ? inv.exdates : undefined,
		organizer: inv.organizer
			? {
					email: inv.organizer.email,
					name: inv.organizer.name,
					internal: myAddresses.includes(inv.organizer.email)
				}
			: ev.organizer
				? { email: ev.organizer.toLowerCase(), name: ev.organizerName, internal: false }
				: undefined,
		attendees,
		privacy,
		sourceMessageId,
		threadSubject: ev.summary,
		reminders: inv.reminders.length
			? inv.reminders
			: defaultReminderMinutes === null
				? undefined
				: [{ minutesBefore: defaultReminderMinutes }],
		uid: inv.uid,
		sequence: inv.sequence,
		createdAt: now,
		updatedAt: now
	};
}
