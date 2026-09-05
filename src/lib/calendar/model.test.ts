import { describe, expect, it } from 'vitest';
import {
	ModelError,
	parseItem,
	parseMeta,
	parseState,
	serializeItem,
	type CalendarItem
} from './model';

const base: CalendarItem = {
	schemaVersion: 1,
	id: 'item-1',
	kind: 'event',
	calendarId: 'cal-1',
	title: 'Standup',
	start: { dateTime: '2026-09-07T09:30:00', timeZone: 'Europe/Paris' },
	end: { dateTime: '2026-09-07T09:45:00', timeZone: 'Europe/Paris' },
	privacy: 'busy',
	uid: 'item-1@thelemail.com',
	sequence: 0,
	createdAt: '2026-09-04T10:00:00.000Z',
	updatedAt: '2026-09-04T10:00:00.000Z'
};

describe('parseItem', () => {
	it('round trips through serialize', () => {
		const withExtras: CalendarItem = {
			...base,
			rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
			exdates: ['2026-09-14T09:30:00'],
			overrides: {
				'2026-09-16T09:30:00': {
					title: 'Standup (moved)',
					start: { dateTime: '2026-09-16T10:00:00' }
				}
			},
			attendees: [
				{
					email: 'a@x.test',
					partstat: 'accepted',
					role: 'req',
					internal: true
				}
			],
			reminders: [{ minutesBefore: 10 }],
			owner: { email: 'me@x.test' }
		};
		const parsed = parseItem(serializeItem(withExtras));
		expect(parsed).toEqual(withExtras);
	});

	it('tolerates unknown keys and fills defaults', () => {
		const parsed = parseItem({
			...base,
			mystery: 1,
			sequence: undefined,
			attendees: [{ email: 'b@x.test' }]
		});
		expect(parsed.sequence).toBe(0);
		expect(parsed.attendees?.[0]).toEqual({
			email: 'b@x.test',
			partstat: 'needs-action',
			role: 'req',
			internal: false
		});
		expect('mystery' in parsed).toBe(false);
	});

	it('rejects a newer schema', () => {
		expect(() => parseItem({ ...base, schemaVersion: 2 })).toThrowError(ModelError);
		try {
			parseItem({ ...base, schemaVersion: 2 });
		} catch (e) {
			expect((e as ModelError).code).toBe('unsupported_schema');
		}
	});

	it('accepts all-day and rejects mixed shapes', () => {
		const allDay = parseItem({
			...base,
			start: { date: '2026-09-07' },
			end: { date: '2026-09-08' }
		});
		expect(allDay.start).toEqual({ date: '2026-09-07' });
		expect(() => parseItem({ ...base, start: { date: '2026-09-07' } })).toThrowError(ModelError);
	});

	it('lets tasks omit a timebox and normalises short wall times', () => {
		const task = parseItem({
			...base,
			kind: 'task',
			start: undefined,
			end: undefined,
			due: { dateTime: '2026-09-10T18:00' }
		});
		expect(task.start).toBeUndefined();
		expect(task.due).toEqual({ dateTime: '2026-09-10T18:00:00' });
	});
});

describe('meta and state', () => {
	it('parses meta with defaults', () => {
		expect(parseMeta({ schemaVersion: 1, name: 'Family' })).toEqual({
			schemaVersion: 1,
			name: 'Family',
			color: '#2E5440',
			defaultPrivacy: 'busy'
		});
	});

	it('parses member state', () => {
		expect(
			parseState({
				schemaVersion: 1,
				ack: { at: '2026-09-04T10:00:00Z' },
				partstat: 'accepted',
				junk: 1
			})
		).toEqual({
			schemaVersion: 1,
			ack: { at: '2026-09-04T10:00:00Z' },
			partstat: 'accepted'
		});
	});
});
