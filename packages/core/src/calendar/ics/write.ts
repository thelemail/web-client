import ICAL from 'ical.js';
import {
	isAllDay,
	type Attendee,
	type CalendarItem,
	type Partstat,
	type WhenValue
} from '../model';
import type { Occurrence } from '../recur';
import { deviceTimeZone } from '../tz';

export interface IcsIdentity {
	email: string;
	name?: string;
}

export interface IcsOptions {
	method: 'REQUEST' | 'CANCEL' | 'PUBLISH';
	organizer: IcsIdentity;
	attendees: Attendee[];
	now?: Date;
	occurrence?: Occurrence;
	cancelled?: boolean;
}

const PARTSTAT: Record<Partstat, string> = {
	'needs-action': 'NEEDS-ACTION',
	accepted: 'ACCEPTED',
	tentative: 'TENTATIVE',
	declined: 'DECLINED'
};

function pad(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}

export function escapeText(s: string): string {
	return s
		.replace(/\\/g, '\\\\')
		.replace(/\r?\n/g, '\\n')
		.replace(/,/g, '\\,')
		.replace(/;/g, '\\;');
}

export function escapeParam(s: string): string {
	const cleaned = s.replace(/["]/g, '');
	return /[:;,]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

export function foldLines(lines: string[]): string[] {
	const out: string[] = [];
	for (const line of lines) {
		if (line.length <= 75) {
			out.push(line);
			continue;
		}
		let rest = line;
		out.push(rest.slice(0, 75));
		rest = rest.slice(75);
		while (rest.length > 0) {
			out.push(' ' + rest.slice(0, 74));
			rest = rest.slice(74);
		}
	}
	return out;
}

export function formatUtc(d: Date): string {
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function compactWall(wall: string): string {
	return wall.replace(/[-:]/g, '').slice(0, 15);
}

function compactDate(date: string): string {
	return date.replace(/-/g, '').slice(0, 8);
}

function whenProp(name: string, w: WhenValue, zone: string): string {
	if (isAllDay(w)) return `${name};VALUE=DATE:${compactDate(w.date)}`;
	const tz = w.timeZone ?? zone;
	return `${name};TZID=${tz}:${compactWall(w.dateTime)}`;
}

function offsetMinutes(timeZone: string, at: Date): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(at);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		get('hour'),
		get('minute'),
		get('second')
	);
	return Math.round((asUtc - at.getTime()) / 60000);
}

function offsetString(minutes: number): string {
	const sign = minutes < 0 ? '-' : '+';
	const abs = Math.abs(minutes);
	return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}

function wallAt(timeZone: string, at: Date): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hourCycle: 'h23',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	}).formatToParts(at);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
	return `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`;
}

export function buildVTimezone(timeZone: string, from: Date, to: Date): string[] {
	const lines = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`];
	const step = 60 * 60 * 1000;
	let cursor = from.getTime();
	let previous = offsetMinutes(timeZone, new Date(cursor));
	const observances: { at: Date; fromOffset: number; toOffset: number }[] = [];
	while (cursor < to.getTime()) {
		const next = cursor + 24 * step;
		const offset = offsetMinutes(timeZone, new Date(next));
		if (offset !== previous) {
			let lo = cursor;
			let hi = next;
			while (hi - lo > step) {
				const mid = lo + Math.floor((hi - lo) / 2 / step) * step;
				if (offsetMinutes(timeZone, new Date(mid)) === previous) lo = mid;
				else hi = mid;
			}
			observances.push({ at: new Date(hi), fromOffset: previous, toOffset: offset });
			previous = offset;
		}
		cursor = next;
	}
	if (!observances.length) {
		lines.push(
			'BEGIN:STANDARD',
			`DTSTART:${wallAt(timeZone, from)}`,
			`TZOFFSETFROM:${offsetString(previous)}`,
			`TZOFFSETTO:${offsetString(previous)}`,
			'END:STANDARD'
		);
	}
	for (const obs of observances) {
		const kind = obs.toOffset > obs.fromOffset ? 'DAYLIGHT' : 'STANDARD';
		const localStart = new Date(obs.at.getTime() + obs.fromOffset * 60000);
		lines.push(
			`BEGIN:${kind}`,
			`DTSTART:${formatUtc(localStart).slice(0, 15)}`,
			`TZOFFSETFROM:${offsetString(obs.fromOffset)}`,
			`TZOFFSETTO:${offsetString(obs.toOffset)}`,
			`END:${kind}`
		);
	}
	lines.push('END:VTIMEZONE');
	return lines;
}

function zonesOf(item: CalendarItem): string[] {
	const zones = new Set<string>();
	const add = (w?: WhenValue) => {
		if (w && !isAllDay(w)) zones.add(w.timeZone ?? deviceTimeZone());
	};
	add(item.start);
	add(item.end);
	for (const ov of Object.values(item.overrides ?? {})) {
		if ('cancelled' in ov && ov.cancelled) continue;
		add(ov.start);
		add(ov.end);
	}
	return [...zones];
}

function attendeeLines(attendees: Attendee[]): string[] {
	return attendees.map((a) => {
		const params = [
			a.name ? `CN=${escapeParam(a.name)}` : '',
			`ROLE=${a.role === 'opt' ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT'}`,
			`PARTSTAT=${PARTSTAT[a.partstat]}`,
			'RSVP=TRUE'
		].filter(Boolean);
		return `ATTENDEE;${params.join(';')}:mailto:${a.email}`;
	});
}

function eventLines(item: CalendarItem, opts: IcsOptions, now: Date, zone: string): string[] {
	const lines = [
		'BEGIN:VEVENT',
		`UID:${escapeText(item.uid)}`,
		`DTSTAMP:${formatUtc(now)}`,
		`SEQUENCE:${item.sequence}`
	];
	const org = opts.organizer.name ? `;CN=${escapeParam(opts.organizer.name)}` : '';
	lines.push(`ORGANIZER${org}:mailto:${opts.organizer.email}`);
	if (opts.occurrence?.recurrenceId) {
		const rid = opts.occurrence.allDay
			? `RECURRENCE-ID;VALUE=DATE:${compactDate(opts.occurrence.recurrenceId)}`
			: `RECURRENCE-ID;TZID=${opts.occurrence.timeZone}:${compactWall(opts.occurrence.recurrenceId)}`;
		lines.push(rid);
	}
	const title = opts.occurrence?.title ?? item.title;
	const location = opts.occurrence?.location ?? item.location;
	const video = opts.occurrence?.videoUrl ?? item.videoUrl;
	lines.push(`SUMMARY:${escapeText(title || '(untitled)')}`);
	if (location) lines.push(`LOCATION:${escapeText(location)}`);
	if (video) lines.push(`URL:${video}`);
	if (opts.occurrence && item.start && item.end) {
		if (opts.occurrence.allDay) {
			lines.push(
				`DTSTART;VALUE=DATE:${compactDate(opts.occurrence.startWall)}`,
				`DTEND;VALUE=DATE:${compactDate(opts.occurrence.endWall)}`
			);
		} else {
			lines.push(
				`DTSTART;TZID=${opts.occurrence.timeZone}:${compactWall(opts.occurrence.startWall)}`,
				`DTEND;TZID=${opts.occurrence.timeZone}:${compactWall(opts.occurrence.endWall)}`
			);
		}
	} else if (item.start && item.end) {
		lines.push(whenProp('DTSTART', item.start, zone), whenProp('DTEND', item.end, zone));
		if (item.rrule) lines.push(`RRULE:${item.rrule}`);
		const allDay = isAllDay(item.start);
		const tz = !allDay && !isAllDay(item.start) ? (item.start.timeZone ?? zone) : zone;
		const exdates = [...(item.exdates ?? [])];
		for (const [rid, ov] of Object.entries(item.overrides ?? {})) {
			if ('cancelled' in ov && ov.cancelled) exdates.push(rid);
		}
		for (const ex of exdates) {
			lines.push(
				allDay ? `EXDATE;VALUE=DATE:${compactDate(ex)}` : `EXDATE;TZID=${tz}:${compactWall(ex)}`
			);
		}
	}
	lines.push(...attendeeLines(opts.attendees));
	if (opts.cancelled || opts.method === 'CANCEL') lines.push('STATUS:CANCELLED');
	for (const r of item.reminders ?? []) {
		lines.push(
			'BEGIN:VALARM',
			'ACTION:DISPLAY',
			`DESCRIPTION:${escapeText(title || 'Reminder')}`,
			`TRIGGER:-PT${r.minutesBefore}M`,
			'END:VALARM'
		);
	}
	lines.push('END:VEVENT');
	return lines;
}

function overrideLines(item: CalendarItem, opts: IcsOptions, now: Date, zone: string): string[] {
	if (!item.overrides || !item.start) return [];
	const out: string[] = [];
	const allDay = isAllDay(item.start);
	const masterZone = !isAllDay(item.start) ? (item.start.timeZone ?? zone) : zone;
	for (const [rid, ov] of Object.entries(item.overrides)) {
		if ('cancelled' in ov && ov.cancelled) continue;
		const start = ov.start ?? (allDay ? { date: rid } : { dateTime: rid, timeZone: masterZone });
		const end = ov.end ?? start;
		out.push(
			'BEGIN:VEVENT',
			`UID:${escapeText(item.uid)}`,
			`DTSTAMP:${formatUtc(now)}`,
			`SEQUENCE:${item.sequence}`
		);
		out.push(
			allDay
				? `RECURRENCE-ID;VALUE=DATE:${compactDate(rid)}`
				: `RECURRENCE-ID;TZID=${masterZone}:${compactWall(rid)}`
		);
		const org = opts.organizer.name ? `;CN=${escapeParam(opts.organizer.name)}` : '';
		out.push(`ORGANIZER${org}:mailto:${opts.organizer.email}`);
		out.push(`SUMMARY:${escapeText(ov.title ?? item.title ?? '(untitled)')}`);
		const loc = ov.location ?? item.location;
		if (loc) out.push(`LOCATION:${escapeText(loc)}`);
		out.push(whenProp('DTSTART', start, zone), whenProp('DTEND', end, zone));
		out.push(...attendeeLines(ov.attendees ?? opts.attendees));
		out.push('END:VEVENT');
	}
	return out;
}

export function buildItemIcs(item: CalendarItem, opts: IcsOptions): string {
	const now = opts.now ?? new Date();
	const zone = deviceTimeZone();
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Thelemail//Calendar//EN',
		`METHOD:${opts.method}`
	];
	const from = new Date(now.getTime() - 366 * 86400000);
	const to = new Date(now.getTime() + 2 * 366 * 86400000);
	for (const tz of zonesOf(item)) lines.push(...buildVTimezone(tz, from, to));
	lines.push(...eventLines(item, opts, now, zone));
	if (!opts.occurrence) lines.push(...overrideLines(item, opts, now, zone));
	lines.push('END:VCALENDAR');
	return foldLines(lines).join('\r\n') + '\r\n';
}

export function buildReplyIcs(
	item: CalendarItem,
	me: IcsIdentity,
	partstat: Partstat,
	organizer: IcsIdentity,
	now = new Date()
): string {
	const zone = deviceTimeZone();
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Thelemail//Calendar//EN',
		'METHOD:REPLY',
		'BEGIN:VEVENT'
	];
	lines.push(
		`UID:${escapeText(item.uid)}`,
		`DTSTAMP:${formatUtc(now)}`,
		`SEQUENCE:${item.sequence}`
	);
	lines.push(`SUMMARY:${escapeText(item.title || '(untitled)')}`);
	if (item.start && item.end)
		lines.push(whenProp('DTSTART', item.start, zone), whenProp('DTEND', item.end, zone));
	const org = organizer.name ? `;CN=${escapeParam(organizer.name)}` : '';
	lines.push(`ORGANIZER${org}:mailto:${organizer.email}`);
	const cn = me.name ? `;CN=${escapeParam(me.name)}` : '';
	lines.push(`ATTENDEE${cn};PARTSTAT=${PARTSTAT[partstat]};RSVP=FALSE:mailto:${me.email}`);
	lines.push('END:VEVENT', 'END:VCALENDAR');
	return foldLines(lines).join('\r\n') + '\r\n';
}

export function untilBefore(rrule: string, startWall: string, allDay: boolean): string {
	const recur = ICAL.Recur.fromString(rrule);
	const until = allDay
		? ICAL.Time.fromDateString(startWall.slice(0, 10)).adjust(-1, 0, 0, 0)
		: ICAL.Time.fromDateTimeString(startWall.slice(0, 19)).adjust(0, 0, -1, 0);
	recur.until = until;
	recur.count = null;
	return recur.toString();
}

export function rruleSummary(rrule: string | undefined): string {
	if (!rrule) return 'Does not repeat';
	try {
		const recur = ICAL.Recur.fromString(rrule);
		const every = recur.interval > 1 ? `every ${recur.interval} ` : 'every ';
		const unit: Record<string, string> = {
			DAILY: 'day',
			WEEKLY: 'week',
			MONTHLY: 'month',
			YEARLY: 'year'
		};
		const base = `${every}${unit[recur.freq] ?? recur.freq.toLowerCase()}${recur.interval > 1 ? 's' : ''}`;
		const days = (recur.parts.BYDAY as string[] | undefined)
			?.map((d) => d.replace(/^[-+]?\d+/, ''))
			.join(', ');
		const tail = recur.count
			? `, ${recur.count} times`
			: recur.until
				? `, until ${recur.until.toString().slice(0, 10)}`
				: '';
		return `Repeats ${base}${days && recur.freq === 'WEEKLY' ? ` on ${days}` : ''}${tail}`;
	} catch {
		return 'Repeats';
	}
}
