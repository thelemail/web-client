import { describe, expect, it } from 'vitest';
import type { CalendarItem } from '../model';
import { expandItem } from '../recur';
import { parseInvitation } from './fromMail';
import { buildItemIcs, buildReplyIcs, buildVTimezone, rruleSummary, untilBefore } from './write';

const item: CalendarItem = {
	schemaVersion: 1,
	id: 'abc',
	kind: 'event',
	calendarId: 'c',
	title: 'Design critique, weekly; bring notes',
	location: 'Studio · 12 rue de Thélème',
	notes: 'secret notes',
	start: { dateTime: '2026-03-23T15:00:00', timeZone: 'Europe/Paris' },
	end: { dateTime: '2026-03-23T16:00:00', timeZone: 'Europe/Paris' },
	rrule: 'FREQ=WEEKLY;BYDAY=MO',
	overrides: {
		'2026-03-30T15:00:00': { cancelled: true },
		'2026-04-06T15:00:00': {
			title: 'Design critique (moved)',
			start: { dateTime: '2026-04-06T17:00:00', timeZone: 'Europe/Paris' },
			end: { dateTime: '2026-04-06T18:00:00', timeZone: 'Europe/Paris' }
		}
	},
	organizer: { email: 'me@meudon.fr', name: 'François', internal: true },
	attendees: [
		{ email: 'alex@meudon.fr', name: 'Alex', partstat: 'accepted', role: 'req', internal: true },
		{ email: 'panurge@quart-livre.example', partstat: 'needs-action', role: 'opt', internal: false }
	],
	reminders: [{ minutesBefore: 10 }],
	privacy: 'busy',
	uid: 'abc@meudon.fr',
	sequence: 2,
	createdAt: '2026-03-01T00:00:00Z',
	updatedAt: '2026-03-01T00:00:00Z'
};

describe('buildItemIcs', () => {
	it('writes a REQUEST that parses back with recurrence, exceptions and guests', () => {
		const ics = buildItemIcs(item, {
			method: 'REQUEST',
			organizer: { email: 'me@meudon.fr', name: 'François' },
			attendees: item.attendees ?? [],
			now: new Date('2026-03-20T12:00:00Z')
		});
		expect(ics).toContain('METHOD:REQUEST');
		expect(ics).toContain('BEGIN:VTIMEZONE');
		expect(ics).toContain('TZID:Europe/Paris');
		expect(ics).toContain('DTSTART;TZID=Europe/Paris:20260323T150000');
		expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
		expect(ics).toContain('EXDATE;TZID=Europe/Paris:20260330T150000');
		expect(ics).toContain('RECURRENCE-ID;TZID=Europe/Paris:20260406T150000');
		expect(ics).toContain('TRIGGER:-PT10M');
		expect(ics).not.toContain('secret notes');
		expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true);

		const parsed = parseInvitation(ics, ['alex@meudon.fr']);
		expect(parsed?.uid).toBe('abc@meudon.fr');
		expect(parsed?.method).toBe('REQUEST');
		expect(parsed?.summary).toBe('Design critique, weekly; bring notes');
		expect(parsed?.start).toEqual({ dateTime: '2026-03-23T15:00:00', timeZone: 'Europe/Paris' });
		expect(parsed?.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
		expect(parsed?.exdates).toEqual(['2026-03-30T15:00:00']);
		expect(parsed?.attendees.map((a) => [a.email, a.partstat, a.role, a.internal])).toEqual([
			['alex@meudon.fr', 'accepted', 'req', true],
			['panurge@quart-livre.example', 'needs-action', 'opt', false]
		]);
		expect(parsed?.reminders).toEqual([{ minutesBefore: 10 }]);
		expect(parsed?.sequence).toBe(2);
	});

	it('writes a single-occurrence CANCEL with a recurrence id', () => {
		const occ = expandItem(
			item,
			new Date('2026-04-12T00:00:00Z'),
			new Date('2026-04-14T00:00:00Z')
		)[0];
		const ics = buildItemIcs(item, {
			method: 'CANCEL',
			organizer: { email: 'me@meudon.fr' },
			attendees: item.attendees ?? [],
			occurrence: occ,
			cancelled: true
		});
		expect(ics).toContain('RECURRENCE-ID;TZID=Europe/Paris:20260413T150000');
		expect(ics).toContain('STATUS:CANCELLED');
		expect(ics).not.toContain('RRULE');
	});

	it('writes all-day events as dates', () => {
		const allDay: CalendarItem = {
			...item,
			rrule: undefined,
			overrides: undefined,
			start: { date: '2026-09-05' },
			end: { date: '2026-09-07' }
		};
		const ics = buildItemIcs(allDay, {
			method: 'PUBLISH',
			organizer: { email: 'me@meudon.fr' },
			attendees: []
		});
		expect(ics).toContain('DTSTART;VALUE=DATE:20260905');
		expect(ics).toContain('DTEND;VALUE=DATE:20260907');
		expect(ics).not.toContain('VTIMEZONE');
		const parsed = parseInvitation(ics, []);
		expect(parsed?.start).toEqual({ date: '2026-09-05' });
		expect(parsed?.end).toEqual({ date: '2026-09-07' });
	});
});

describe('buildVTimezone', () => {
	it('lists both 2026 Paris transitions', () => {
		const lines = buildVTimezone(
			'Europe/Paris',
			new Date('2026-01-01T00:00:00Z'),
			new Date('2026-12-31T00:00:00Z')
		);
		expect(lines.filter((l) => l === 'BEGIN:DAYLIGHT')).toHaveLength(1);
		expect(lines.filter((l) => l === 'BEGIN:STANDARD')).toHaveLength(1);
		expect(lines).toContain('DTSTART:20260329T020000');
		expect(lines).toContain('TZOFFSETFROM:+0100');
		expect(lines).toContain('TZOFFSETTO:+0200');
		expect(lines).toContain('DTSTART:20261025T030000');
	});
});

describe('replies and rrule helpers', () => {
	it('writes a REPLY with the partstat', () => {
		const ics = buildReplyIcs(
			item,
			{ email: 'alex@meudon.fr', name: 'Alex' },
			'declined',
			item.organizer!
		);
		expect(ics).toContain('METHOD:REPLY');
		expect(ics).toContain('ATTENDEE;CN=Alex;PARTSTAT=DECLINED;RSVP=FALSE:mailto:alex@meudon.fr');
		expect(parseInvitation(ics, [])?.attendees[0].partstat).toBe('declined');
	});

	it('ends a series before an occurrence', () => {
		expect(untilBefore('FREQ=WEEKLY;BYDAY=MO;COUNT=10', '2026-04-06T15:00:00', false)).toBe(
			'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260406T145900'
		);
		expect(untilBefore('FREQ=DAILY', '2026-04-06', true)).toBe('FREQ=DAILY;UNTIL=20260405');
	});

	it('summarises rules', () => {
		expect(rruleSummary(undefined)).toBe('Does not repeat');
		expect(rruleSummary('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5')).toBe(
			'Repeats every week on MO, WE, 5 times'
		);
		expect(rruleSummary('FREQ=MONTHLY;INTERVAL=2')).toBe('Repeats every 2 months');
	});
});
