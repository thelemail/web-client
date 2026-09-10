import { describe, expect, it } from 'vitest';
import {
	parseLocalInput,
	returnedFromSnooze,
	scheduleBounds,
	schedulePresets,
	snoozeBounds,
	snoozePresets,
	toLocalInput,
	validateWhen
} from './timePresets';

const WED_NOON = new Date(2026, 7, 5, 12, 0, 0, 0);

describe('snoozePresets', () => {
	it('offers later today, tomorrow, weekend and next week on a weekday morning', () => {
		const presets = snoozePresets(WED_NOON);
		expect(presets.map((p) => p.id)).toEqual([
			'later-today',
			'tomorrow',
			'this-weekend',
			'next-week'
		]);
	});

	it('drops later today once the evening slot has passed', () => {
		const presets = snoozePresets(new Date(2026, 7, 5, 19, 30));
		expect(presets.map((p) => p.id)).not.toContain('later-today');
		expect(presets[0].id).toBe('tomorrow');
	});

	it('drops the weekend option on a Saturday', () => {
		const saturday = new Date(2026, 7, 8, 9, 0);
		expect(saturday.getDay()).toBe(6);
		expect(snoozePresets(saturday).map((p) => p.id)).not.toContain('this-weekend');
	});

	it('lands on the expected clock times', () => {
		const byId = new Map(snoozePresets(WED_NOON).map((p) => [p.id, p.when]));
		expect(byId.get('later-today')).toEqual(new Date(2026, 7, 5, 18, 0, 0, 0));
		expect(byId.get('tomorrow')).toEqual(new Date(2026, 7, 6, 8, 0, 0, 0));
		expect(byId.get('this-weekend')).toEqual(new Date(2026, 7, 8, 8, 0, 0, 0));
		expect(byId.get('next-week')).toEqual(new Date(2026, 7, 10, 8, 0, 0, 0));
	});

	it('never returns a preset in the past', () => {
		for (const hour of [0, 6, 12, 17, 18, 21, 23]) {
			const now = new Date(2026, 7, 5, hour, 45);
			for (const p of snoozePresets(now)) {
				expect(p.when.getTime()).toBeGreaterThan(now.getTime());
			}
		}
	});
});

describe('schedulePresets', () => {
	it('offers the four send slots on a weekday morning', () => {
		expect(schedulePresets(WED_NOON).map((p) => p.id)).toEqual([
			'later-today',
			'tomorrow-morning',
			'tomorrow-afternoon',
			'monday-morning'
		]);
	});

	it('honours the two minute lead time', () => {
		const justBefore = new Date(2026, 7, 5, 17, 59);
		expect(schedulePresets(justBefore).map((p) => p.id)).not.toContain('later-today');
	});
});

describe('validateWhen', () => {
	it('rejects a missing or unparseable time', () => {
		expect(validateWhen(null, snoozeBounds(WED_NOON))).toBe('invalid');
		expect(validateWhen(new Date('nope'), snoozeBounds(WED_NOON))).toBe('invalid');
	});

	it('rejects the past', () => {
		const bounds = snoozeBounds(WED_NOON);
		expect(validateWhen(new Date(WED_NOON.getTime() - 1000), bounds)).toBe('past');
		expect(validateWhen(WED_NOON, bounds)).toBe('past');
	});

	it('rejects a schedule inside the lead time', () => {
		const bounds = scheduleBounds(WED_NOON);
		expect(validateWhen(new Date(WED_NOON.getTime() + 30_000), bounds)).toBe('too_soon');
		expect(validateWhen(new Date(WED_NOON.getTime() + 5 * 60_000), bounds)).toBeNull();
	});

	it('rejects beyond the horizon', () => {
		const day = 24 * 60 * 60 * 1000;
		expect(validateWhen(new Date(WED_NOON.getTime() + 31 * day), scheduleBounds(WED_NOON))).toBe(
			'too_far'
		);
		expect(validateWhen(new Date(WED_NOON.getTime() + 31 * day), snoozeBounds(WED_NOON))).toBeNull();
		expect(validateWhen(new Date(WED_NOON.getTime() + 366 * day), snoozeBounds(WED_NOON))).toBe(
			'too_far'
		);
	});
});

describe('local datetime input round trip', () => {
	it('formats in local time and parses back to the same instant', () => {
		const value = toLocalInput(WED_NOON);
		expect(value).toBe('2026-08-05T12:00');
		expect(parseLocalInput(value)?.getTime()).toBe(WED_NOON.getTime());
	});

	it('returns null for an empty value', () => {
		expect(parseLocalInput('')).toBeNull();
		expect(parseLocalInput('   ')).toBeNull();
	});
});

describe('returnedFromSnooze', () => {
	const nowMs = WED_NOON.getTime();
	const base = { folder: 'inbox', unread: true, snoozedUntil: new Date(nowMs - 60_000).toISOString() };

	it('flags an unread inbox row whose snooze has elapsed', () => {
		expect(returnedFromSnooze(base, nowMs)).toBe(true);
	});

	it('ignores rows that were never snoozed', () => {
		expect(returnedFromSnooze({ ...base, snoozedUntil: null }, nowMs)).toBe(false);
		expect(returnedFromSnooze({ folder: 'inbox', unread: true }, nowMs)).toBe(false);
	});

	it('ignores rows still waiting to come back', () => {
		const future = new Date(nowMs + 60_000).toISOString();
		expect(returnedFromSnooze({ ...base, snoozedUntil: future }, nowMs)).toBe(false);
	});

	it('ignores rows the user has already read or moved out of the inbox', () => {
		expect(returnedFromSnooze({ ...base, unread: false }, nowMs)).toBe(false);
		expect(returnedFromSnooze({ ...base, folder: 'archive' }, nowMs)).toBe(false);
		expect(returnedFromSnooze({ ...base, folder: 'snoozed' }, nowMs)).toBe(false);
	});

	it('ignores an unparseable timestamp', () => {
		expect(returnedFromSnooze({ ...base, snoozedUntil: 'soon' }, nowMs)).toBe(false);
	});
});
