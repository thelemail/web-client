import {
	CalendarDate,
	CalendarDateTime,
	fromDate,
	parseDate,
	parseDateTime,
	toCalendarDate,
	toCalendarDateTime,
	toZoned
} from '@internationalized/date';
import { isAllDay, type WhenValue } from './model';

export function deviceTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function supportedTimeZones(): string[] {
	const intl = Intl as unknown as {
		supportedValuesOf?: (key: string) => string[];
	};
	if (typeof intl.supportedValuesOf === 'function') {
		try {
			return intl.supportedValuesOf('timeZone');
		} catch {
			return [deviceTimeZone()];
		}
	}
	return [deviceTimeZone()];
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : `${n}`;
}

export function formatWall(dt: CalendarDateTime): string {
	return `${dt.year}-${pad(dt.month)}-${pad(dt.day)}T${pad(dt.hour)}:${pad(dt.minute)}:${pad(dt.second)}`;
}

export function formatDate(d: CalendarDate | CalendarDateTime): string {
	return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

export function wallToInstant(wall: string, timeZone?: string): Date {
	return toZoned(parseDateTime(wall), timeZone || deviceTimeZone()).toDate();
}

export function instantToWall(d: Date, timeZone?: string): string {
	return formatWall(toCalendarDateTime(fromDate(d, timeZone || deviceTimeZone())));
}

export function dateToInstant(date: string, timeZone?: string): Date {
	return toZoned(parseDate(date), timeZone || deviceTimeZone()).toDate();
}

export function instantToDate(d: Date, timeZone?: string): string {
	return formatDate(toCalendarDate(fromDate(d, timeZone || deviceTimeZone())));
}

export function whenToInstant(w: WhenValue, fallbackZone?: string): Date {
	if (isAllDay(w)) return dateToInstant(w.date, fallbackZone);
	return wallToInstant(w.dateTime, w.timeZone ?? fallbackZone);
}

export function whenDate(w: WhenValue): string {
	return isAllDay(w) ? w.date : w.dateTime.slice(0, 10);
}

export function addDays(date: string, n: number): string {
	return formatDate(parseDate(date).add({ days: n }));
}

export function addMinutesWall(wall: string, minutes: number): string {
	return formatWall(parseDateTime(wall).add({ minutes }));
}

export function wallMinutesBetween(startWall: string, endWall: string): number {
	const a = Date.UTC(...wallParts(startWall));
	const b = Date.UTC(...wallParts(endWall));
	return Math.round((b - a) / 60000);
}

function wallParts(wall: string): [number, number, number, number, number, number] {
	const dt = parseDateTime(wall);
	return [dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second];
}

export function daysBetween(startDate: string, endDate: string): number {
	return parseDate(endDate).compare(parseDate(startDate));
}

export function todayDate(timeZone?: string): string {
	return instantToDate(new Date(), timeZone);
}

export function zoneAbbreviation(timeZone: string, at = new Date()): string {
	try {
		const parts = new Intl.DateTimeFormat('en-US', {
			timeZone,
			timeZoneName: 'short'
		}).formatToParts(at);
		return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
	} catch {
		return timeZone;
	}
}
