import { describe, expect, it } from 'vitest';
import {
	addMinutesWall,
	instantToWall,
	wallMinutesBetween,
	wallToInstant,
	whenToInstant
} from './tz';

describe('wall clock conversion', () => {
	it('keeps 09:00 wall time across the Paris DST change', () => {
		const before = wallToInstant('2026-03-28T09:00:00', 'Europe/Paris');
		const after = wallToInstant('2026-03-30T09:00:00', 'Europe/Paris');
		expect(before.toISOString()).toBe('2026-03-28T08:00:00.000Z');
		expect(after.toISOString()).toBe('2026-03-30T07:00:00.000Z');
		expect(instantToWall(after, 'Europe/Paris')).toBe('2026-03-30T09:00:00');
	});

	it('handles the autumn change', () => {
		const before = wallToInstant('2026-10-24T09:00:00', 'Europe/Paris');
		const after = wallToInstant('2026-10-26T09:00:00', 'Europe/Paris');
		expect(before.toISOString()).toBe('2026-10-24T07:00:00.000Z');
		expect(after.toISOString()).toBe('2026-10-26T08:00:00.000Z');
	});

	it('treats all-day values as local midnight in the zone', () => {
		expect(whenToInstant({ date: '2026-09-07' }, 'America/New_York').toISOString()).toBe(
			'2026-09-07T04:00:00.000Z'
		);
	});

	it('does wall arithmetic without touching offsets', () => {
		expect(wallMinutesBetween('2026-03-29T01:00:00', '2026-03-29T04:00:00')).toBe(180);
		expect(addMinutesWall('2026-03-29T01:30:00', 90)).toBe('2026-03-29T03:00:00');
	});
});
