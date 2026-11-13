import { CalendarDate, fromAbsolute, toZoned } from '@internationalized/date';

const ABSOLUTE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const RELATIVE = /^(\d{1,6})([dmy])$/i;
const DAY_MS = 86_400_000;
const MAX_RELATIVE = { d: 3_660_000, m: 120_000, y: 10_000 } as const;

function daysIn(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function validTimeZone(timeZone: string): string {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone });
		return timeZone;
	} catch {
		return 'UTC';
	}
}

export function absoluteDate(value: string, timeZone: string): number | null {
	const match = ABSOLUTE.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) return null;
	return toZoned(new CalendarDate(year, month, day), timeZone, 'compatible').toDate().getTime();
}

export function relativeDate(value: string, now: number, timeZone: string): number | null {
	const match = RELATIVE.exec(value);
	if (!match) return null;
	const amount = Number(match[1]);
	const unit = match[2].toLowerCase() as 'd' | 'm' | 'y';
	if (amount > MAX_RELATIVE[unit]) return null;
	if (unit === 'd') return now - amount * DAY_MS;
	const zoned = fromAbsolute(now, timeZone);
	const shifted = unit === 'm' ? zoned.subtract({ months: amount }) : zoned.subtract({ years: amount });
	if (shifted.year < 1) return null;
	return shifted.toDate().getTime();
}
