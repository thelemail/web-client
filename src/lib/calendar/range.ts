import { getDayOfWeek, parseDate } from '@internationalized/date';
import { addDays, dateToInstant, formatDate, todayDate } from './tz';

export type WeekStart = 0 | 1;

export interface DayRange {
	startDate: string;
	endDate: string;
	from: Date;
	to: Date;
	dates: string[];
}

export function weekStartOf(date: string, weekStartsOn: WeekStart): string {
	const d = parseDate(date);
	const dow = getDayOfWeek(d, 'en-US');
	const offset = (dow - weekStartsOn + 7) % 7;
	return formatDate(d.subtract({ days: offset }));
}

function build(startDate: string, days: number, timeZone?: string): DayRange {
	const dates: string[] = [];
	for (let i = 0; i < days; i++) dates.push(addDays(startDate, i));
	const endDate = addDays(startDate, days);
	return {
		startDate,
		endDate,
		from: dateToInstant(startDate, timeZone),
		to: dateToInstant(endDate, timeZone),
		dates
	};
}

export function weekRange(anchor: string, weekStartsOn: WeekStart, timeZone?: string): DayRange {
	return build(weekStartOf(anchor, weekStartsOn), 7, timeZone);
}

export function monthRange(
	anchor: string,
	weekStartsOn: WeekStart,
	timeZone?: string
): DayRange & {
	monthStart: string;
	monthEnd: string;
} {
	const d = parseDate(anchor);
	const monthStart = formatDate(d.set({ day: 1 }));
	const monthEnd = formatDate(d.set({ day: d.calendar.getDaysInMonth(d) }));
	const gridStart = weekStartOf(monthStart, weekStartsOn);
	return { ...build(gridStart, 42, timeZone), monthStart, monthEnd };
}

export function agendaRange(anchor: string, days: number, timeZone?: string): DayRange {
	return build(anchor, days, timeZone);
}

export function shiftAnchor(
	anchor: string,
	view: 'week' | 'month' | 'agenda',
	direction: 1 | -1
): string {
	const d = parseDate(anchor);
	switch (view) {
		case 'week':
		case 'agenda':
			return formatDate(d.add({ weeks: direction }));
		case 'month':
			return formatDate(d.add({ months: direction }).set({ day: 1 }));
	}
}

export function today(timeZone?: string): string {
	return todayDate(timeZone);
}

export function isWeekend(date: string): boolean {
	const dow = getDayOfWeek(parseDate(date), 'en-US');
	return dow === 0 || dow === 6;
}
