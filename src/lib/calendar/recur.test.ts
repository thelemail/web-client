import { describe, expect, it } from 'vitest';
import type { CalendarItem } from './model';
import { busyWindows, expandItem, itemSpan } from './recur';

function weekly(overrides: Partial<CalendarItem> = {}): CalendarItem {
	return {
		schemaVersion: 1,
		id: 'w1',
		kind: 'event',
		calendarId: 'c',
		title: 'Standup',
		start: { dateTime: '2026-03-23T09:00:00', timeZone: 'Europe/Paris' },
		end: { dateTime: '2026-03-23T09:30:00', timeZone: 'Europe/Paris' },
		rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
		privacy: 'busy',
		uid: 'w1@x',
		sequence: 0,
		createdAt: '2026-03-01T00:00:00Z',
		updatedAt: '2026-03-01T00:00:00Z',
		...overrides
	};
}

describe('expandItem', () => {
	it('keeps wall time across DST', () => {
		const occ = expandItem(
			weekly(),
			new Date('2026-03-22T00:00:00Z'),
			new Date('2026-04-05T00:00:00Z')
		);
		expect(occ.map((o) => o.startWall)).toEqual([
			'2026-03-23T09:00:00',
			'2026-03-25T09:00:00',
			'2026-03-30T09:00:00',
			'2026-04-01T09:00:00'
		]);
		expect(occ[0].start.toISOString()).toBe('2026-03-23T08:00:00.000Z');
		expect(occ[2].start.toISOString()).toBe('2026-03-30T07:00:00.000Z');
		expect(occ[2].end.getTime() - occ[2].start.getTime()).toBe(30 * 60000);
	});

	it('applies exdates, cancellations and overrides', () => {
		const item = weekly({
			exdates: ['2026-03-25T09:00:00'],
			overrides: {
				'2026-03-30T09:00:00': { cancelled: true },
				'2026-04-01T09:00:00': {
					title: 'Retro',
					start: { dateTime: '2026-04-01T15:00:00', timeZone: 'Europe/Paris' }
				}
			}
		});
		const occ = expandItem(
			item,
			new Date('2026-03-22T00:00:00Z'),
			new Date('2026-04-05T00:00:00Z')
		);
		expect(occ.map((o) => [o.recurrenceId, o.title, o.startWall])).toEqual([
			['2026-03-23T09:00:00', 'Standup', '2026-03-23T09:00:00'],
			['2026-04-01T09:00:00', 'Retro', '2026-04-01T15:00:00']
		]);
		expect(occ[1].end.getTime() - occ[1].start.getTime()).toBe(30 * 60000);
		expect(occ[1].patched).toBe(true);
	});

	it('honours COUNT and UNTIL', () => {
		const counted = weekly({ rrule: 'FREQ=DAILY;COUNT=3' });
		expect(
			expandItem(counted, new Date('2026-03-01T00:00:00Z'), new Date('2026-05-01T00:00:00Z'))
		).toHaveLength(3);
		const until = weekly({ rrule: 'FREQ=DAILY;UNTIL=20260325T000000Z' });
		expect(
			expandItem(until, new Date('2026-03-01T00:00:00Z'), new Date('2026-05-01T00:00:00Z'))
		).toHaveLength(2);
		expect(itemSpan(counted).end).not.toBeNull();
		expect(itemSpan(weekly()).end).toBeNull();
	});

	it('expands multi-day all-day items', () => {
		const item = weekly({
			rrule: undefined,
			start: { date: '2026-09-05' },
			end: { date: '2026-09-07' }
		});
		const occ = expandItem(
			item,
			new Date('2026-09-06T00:00:00Z'),
			new Date('2026-09-06T12:00:00Z')
		);
		expect(occ).toHaveLength(1);
		expect(occ[0].allDay).toBe(true);
		expect(occ[0].endWall).toBe('2026-09-07');
	});

	it('clips to the requested range', () => {
		const occ = expandItem(
			weekly(),
			new Date('2026-06-01T00:00:00Z'),
			new Date('2026-06-08T00:00:00Z')
		);
		expect(occ).toHaveLength(2);
		expect(occ[0].startWall.startsWith('2026-06-01')).toBe(true);
	});
});

describe('busyWindows', () => {
	const now = new Date('2026-03-20T12:00:00Z');

	it('returns nothing for private items and unscheduled tasks', () => {
		expect(busyWindows(weekly({ privacy: 'private' }), now)).toEqual([]);
		expect(busyWindows(weekly({ kind: 'task', start: undefined, end: undefined }), now)).toEqual(
			[]
		);
	});

	it('merges overlaps and caps the count', () => {
		const daily = weekly({ rrule: 'FREQ=DAILY' });
		const windows = busyWindows(daily, now);
		expect(windows.length).toBeGreaterThan(350);
		expect(windows.length).toBeLessThanOrEqual(400);
		expect(windows[0].startsAt).toBe('2026-03-23T08:00:00.000Z');
		const overlapping = weekly({
			rrule: undefined,
			start: { dateTime: '2026-03-23T09:00:00', timeZone: 'Europe/Paris' },
			end: { dateTime: '2026-03-23T11:00:00', timeZone: 'Europe/Paris' }
		});
		expect(busyWindows(overlapping, now)).toEqual([
			{
				startsAt: '2026-03-23T08:00:00.000Z',
				endsAt: '2026-03-23T10:00:00.000Z'
			}
		]);
	});
});
