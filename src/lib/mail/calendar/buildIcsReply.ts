import type { CalendarEvent } from '$lib/mail/render/icalParse';
import type { RsvpStatus } from '$lib/api/types';

const PARTSTAT: Record<RsvpStatus, string> = {
	accepted: 'ACCEPTED',
	tentative: 'TENTATIVE',
	declined: 'DECLINED'
};

export interface BuildReplyInput {
	source: CalendarEvent;
	myEmail: string;
	myName?: string;
	status: RsvpStatus;
	now?: Date;
}

export interface BuildReplyOutput {
	ics: string;
	subjectPrefix: string;
}

export function buildIcsReply(input: BuildReplyInput): BuildReplyOutput {
	const ev = input.source;
	const now = input.now ?? new Date();

	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Thelemail//RSVP 1.0//EN',
		'METHOD:REPLY',
		'BEGIN:VEVENT',
		`UID:${escapeText(ev.uid ?? `${cryptoRandom()}@thelemail`)}`,
		`DTSTAMP:${formatDtstamp(now)}`,
		`SEQUENCE:${sequenceFor(ev)}`
	];
	if (ev.summary) lines.push(`SUMMARY:${escapeText(ev.summary)}`);
	if (ev.start) lines.push(formatDateProp('DTSTART', ev.start));
	if (ev.end) lines.push(formatDateProp('DTEND', ev.end));
	if (ev.organizer) {
		const params = ev.organizerName ? `;CN=${escapeParam(ev.organizerName)}` : '';
		lines.push(`ORGANIZER${params}:mailto:${ev.organizer}`);
	}
	const cnSelf = input.myName ? `;CN=${escapeParam(input.myName)}` : '';
	lines.push(
		`ATTENDEE${cnSelf};PARTSTAT=${PARTSTAT[input.status]};RSVP=FALSE:mailto:${input.myEmail}`
	);
	lines.push('END:VEVENT');
	lines.push('END:VCALENDAR');

	const subjectPrefix =
		input.status === 'accepted' ? 'Accepted' : input.status === 'tentative' ? 'Tentative' : 'Declined';

	return { ics: foldLines(lines).join('\r\n') + '\r\n', subjectPrefix };
}

function sequenceFor(ev: CalendarEvent): number {
	const base = Number.isFinite(ev.sequence) ? Number(ev.sequence) : 0;
	return base + 1;
}

function formatDtstamp(d: Date): string {
	const y = d.getUTCFullYear();
	const mo = pad(d.getUTCMonth() + 1);
	const da = pad(d.getUTCDate());
	const hh = pad(d.getUTCHours());
	const mm = pad(d.getUTCMinutes());
	const ss = pad(d.getUTCSeconds());
	return `${y}${mo}${da}T${hh}${mm}${ss}Z`;
}

function formatDateProp(name: string, dt: { iso: string; tzid?: string; allDay: boolean }): string {
	const iso = dt.iso;
	if (dt.allDay) {
		const raw = iso.replace(/-/g, '');
		return `${name};VALUE=DATE:${raw}`;
	}
	if (iso.endsWith('Z')) {
		return `${name}:${iso.replace(/[-:]/g, '')}`;
	}
	const raw = iso.replace(/[-:]/g, '');
	return dt.tzid ? `${name};TZID=${dt.tzid}:${raw}` : `${name}:${raw}`;
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}

function escapeText(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/[\r\n]+/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function escapeParam(s: string): string {
	const needsQuotes = /[":,;]/.test(s);
	const cleaned = s.replace(/["]/g, '');
	return needsQuotes ? `"${cleaned}"` : cleaned;
}

function foldLines(lines: string[]): string[] {
	const out: string[] = [];
	for (const l of lines) {
		if (l.length <= 75) {
			out.push(l);
			continue;
		}
		let rest = l;
		out.push(rest.slice(0, 75));
		rest = rest.slice(75);
		while (rest.length > 0) {
			out.push(' ' + rest.slice(0, 74));
			rest = rest.slice(74);
		}
	}
	return out;
}

function cryptoRandom(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return Math.random().toString(36).slice(2);
}
