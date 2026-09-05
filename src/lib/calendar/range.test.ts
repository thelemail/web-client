import { describe, expect, it } from 'vitest';
import { monthRange, shiftAnchor, weekRange, weekStartOf } from './range';

describe('ranges', () => {
	it('starts the week on Monday or Sunday', () => {
		expect(weekStartOf('2026-09-04', 1)).toBe('2026-08-31');
		expect(weekStartOf('2026-09-04', 0)).toBe('2026-08-30');
		expect(weekStartOf('2026-08-31', 1)).toBe('2026-08-31');
	});

	it('builds a seven day week with instants in the zone', () => {
		const r = weekRange('2026-09-04', 1, 'Europe/Paris');
		expect(r.dates).toHaveLength(7);
		expect(r.dates[0]).toBe('2026-08-31');
		expect(r.endDate).toBe('2026-09-07');
		expect(r.from.toISOString()).toBe('2026-08-30T22:00:00.000Z');
	});

	it('builds a 42 cell month grid', () => {
		const m = monthRange('2026-09-15', 1, 'UTC');
		expect(m.monthStart).toBe('2026-09-01');
		expect(m.monthEnd).toBe('2026-09-30');
		expect(m.dates[0]).toBe('2026-08-31');
		expect(m.dates).toHaveLength(42);
	});

	it('shifts anchors by view', () => {
		expect(shiftAnchor('2026-09-04', 'week', 1)).toBe('2026-09-11');
		expect(shiftAnchor('2026-01-31', 'month', 1)).toBe('2026-02-01');
		expect(shiftAnchor('2026-09-04', 'month', -1)).toBe('2026-08-01');
	});
});
