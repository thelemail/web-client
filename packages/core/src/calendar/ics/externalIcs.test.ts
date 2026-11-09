// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarItem } from '../model';
import { buildItemIcs, buildReplyIcs } from './write';

vi.mock('../tz', async (importOriginal) => ({
	...(await importOriginal<typeof import('../tz')>()),
	deviceTimeZone: () => 'Europe/Paris'
}));

const fixtureItem: CalendarItem = {
	schemaVersion: 1,
	id: '0f1b7c2e-5a44-4c1e-9d0b-2f7e8a6c4d11',
	kind: 'event',
	calendarId: '7a2c9e10-3b5d-4f6a-8c1e-0d9b2a4f6e83',
	title: 'Quarterly review',
	location: 'Room 4',
	notes: 'never leaves the calendar',
	start: { dateTime: '2026-12-03T10:00:00', timeZone: 'Europe/Paris' },
	end: { dateTime: '2026-12-03T11:30:00', timeZone: 'Europe/Paris' },
	rrule: 'FREQ=MONTHLY;COUNT=3',
	organizer: { email: 'ada@thelemail.test', name: 'Ada Calloway', internal: true },
	attendees: [
		{ email: 'bruno@thelemail.test', name: 'Bruno Calloway', partstat: 'needs-action', role: 'req', internal: true },
		{ email: 'panurge@quart-livre.example', partstat: 'needs-action', role: 'req', internal: false }
	],
	reminders: [{ minutesBefore: 15 }],
	privacy: 'busy',
	uid: '0f1b7c2e-5a44-4c1e-9d0b-2f7e8a6c4d11@thelemail.test',
	sequence: 1,
	createdAt: '2026-11-01T00:00:00Z',
	updatedAt: '2026-11-01T00:00:00Z'
};

const now = new Date('2026-11-09T12:00:00Z');

function fixtureRequest(): string {
	return buildItemIcs(fixtureItem, {
		method: 'REQUEST',
		organizer: { email: 'ada@thelemail.test', name: 'Ada Calloway' },
		attendees: fixtureItem.attendees ?? [],
		now
	});
}

function fixtureReply(): string {
	return buildReplyIcs(
		fixtureItem,
		{ email: 'ada@thelemail.test', name: 'Ada Calloway' },
		'accepted',
		{ email: 'panurge@quart-livre.example' },
		now
	);
}

const read = (name: string) => readFileSync(new URL(`../testdata/${name}`, import.meta.url), 'utf8');

describe('external invitation bytes', () => {
	it('builds the REQUEST byte for byte as before calendar delivery moved off mail', () => {
		expect(fixtureRequest()).toBe(read('external-request.ics'));
	});

	it('builds the REPLY byte for byte as before calendar delivery moved off mail', () => {
		expect(fixtureReply()).toBe(read('external-reply.ics'));
	});
});
