import { describe, expect, it } from 'vitest';
import { withLocale } from './locale.svelte';
import { weekdayNames } from './intl';
import { formatDateLong, formatDateShort, formatWeekday } from '$core/mail/data';
import { dateLabel, longWhen, monthName, monthYearLabel, rangeTitle } from '$core/calendar/format';
import type { Occurrence } from '$core/calendar/recur';

const date = new Date(Date.UTC(2026, 2, 5, 12));

const allDay = {
	allDay: true,
	startWall: '2026-03-05T00:00',
	endWall: '2026-03-06T00:00'
} as unknown as Occurrence;

describe('English output is unchanged', () => {
	it('keeps the mail patterns', () => {
		expect(formatDateLong(date, 'dmy')).toBe('5 Mar 2026');
		expect(formatDateLong(date, 'mdy')).toBe('Mar 5, 2026');
		expect(formatDateLong(date, 'iso')).toBe('2026-03-05');
		expect(formatWeekday(date)).toBe('Thu');
	});

	it('keeps the calendar labels', () => {
		expect(dateLabel('2026-03-05')).toBe('Thu 5 March');
		expect(dateLabel('2026-03-05', true)).toBe('Thu 5 March 2026');
		expect(monthYearLabel('2026-09-01')).toBe('September 2026');
		expect(rangeTitle('2026-03-02', '2026-03-09')).toBe('2 – 8 March');
		expect(rangeTitle('2026-03-30', '2026-04-06')).toBe('30 Mar – 5 Apr');
		expect(weekdayNames('short', true)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
		expect(weekdayNames('narrow', false)).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
		expect(longWhen(allDay)).toBe('Thu 5 March · all day');
	});
});

describe('other languages', () => {
	it('uses German month and weekday names', () => {
		withLocale('de', () => {
			expect(monthName('2026-03-05')).toBe('März');
			const de = (d: Date) =>
				new Intl.DateTimeFormat('de', { weekday: 'short', timeZone: 'UTC' }).format(d);
			expect(formatWeekday(date)).toBe(de(date));
			expect(weekdayNames('short', true)[0]).toBe(de(new Date(Date.UTC(2024, 0, 8))));
			expect(formatDateShort(date)).toContain('März');
		});
	});

	it('keeps the chosen month-first pattern with French month names', () => {
		withLocale('fr', () => {
			expect(formatDateLong(date, 'mdy')).toBe('mars 5, 2026');
			expect(formatDateLong(date, 'iso')).toBe('2026-03-05');
		});
	});

	it('writes outgoing invitation dates in English regardless of the UI language', () => {
		withLocale('pt', () => {
			expect(longWhen(allDay, undefined, true)).toBe('Thu 5 March · all day');
			expect(longWhen(allDay)).not.toBe('Thu 5 March · all day');
		});
	});
});
