import { parseDate } from '@internationalized/date';
import { locale } from '$core/mail/locale.svelte';
import type { Occurrence } from './recur';
import { deviceTimeZone, instantToWall } from './tz';

const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LONG = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

export function minutesOfWall(wall: string): number {
	const h = Number(wall.slice(11, 13));
	const m = Number(wall.slice(14, 16));
	return h * 60 + m;
}

export function minutes(time: string): number {
	const [h, m] = time.split(':').map(Number);
	return h * 60 + m;
}

export function timeLabel(totalMinutes: number): string {
	const h = Math.floor(totalMinutes / 60) % 24;
	const m = totalMinutes % 60;
	if (locale.timeFormat === '12') {
		const suffix = h >= 12 ? 'pm' : 'am';
		const hour = h % 12 === 0 ? 12 : h % 12;
		return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
	}
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function shortTime(instant: Date, timeZone = deviceTimeZone()): string {
	return timeLabel(minutesOfWall(instantToWall(instant, timeZone)));
}

export function dayOfWeekLabel(date: string): string {
	const d = parseDate(date);
	const js = new Date(Date.UTC(d.year, d.month - 1, d.day));
	return DOW_SHORT[js.getUTCDay()];
}

export function dayLabel(date: string): string {
	return dayOfWeekLabel(date);
}

export function dayNumber(date: string): number {
	return Number(date.slice(8, 10));
}

export function monthName(date: string): string {
	return MONTH_LONG[Number(date.slice(5, 7)) - 1];
}

export function monthShort(date: string): string {
	return monthName(date).slice(0, 3);
}

export function year(date: string): number {
	return Number(date.slice(0, 4));
}

export function dateLabel(date: string, withYear = false): string {
	const base = `${dayOfWeekLabel(date)} ${dayNumber(date)} ${monthName(date)}`;
	return withYear ? `${base} ${year(date)}` : base;
}

export function rangeTitle(startDate: string, endDate: string): string {
	const a = parseDate(startDate);
	const b = parseDate(endDate).subtract({ days: 1 });
	if (a.month === b.month) return `${a.day} – ${b.day} ${monthName(startDate)}`;
	return `${a.day} ${monthShort(startDate)} – ${b.day} ${monthShort(endDate)}`;
}

export function longWhen(occ: Occurrence, timeZone = deviceTimeZone()): string {
	if (occ.allDay) {
		const startDate = occ.startWall.slice(0, 10);
		const lastDate = parseDate(occ.endWall.slice(0, 10)).subtract({ days: 1 });
		const last = `${lastDate.year}-${String(lastDate.month).padStart(2, '0')}-${String(lastDate.day).padStart(2, '0')}`;
		if (last <= startDate) return `${dateLabel(startDate)} · all day`;
		return `${dateLabel(startDate)} – ${dateLabel(last)}`;
	}
	const startWall = instantToWall(occ.start, timeZone);
	const endWall = instantToWall(occ.end, timeZone);
	const sameDay = startWall.slice(0, 10) === endWall.slice(0, 10);
	const startLabel = timeLabel(minutesOfWall(startWall));
	const endLabel = timeLabel(minutesOfWall(endWall));
	if (sameDay) return `${dateLabel(startWall.slice(0, 10))} · ${startLabel} – ${endLabel}`;
	return `${dateLabel(startWall.slice(0, 10))} ${startLabel} – ${dateLabel(endWall.slice(0, 10))} ${endLabel}`;
}

export function relativeDue(date: string, today: string): string {
	const diff = parseDate(date).compare(parseDate(today));
	if (diff === 0) return 'Today';
	if (diff === 1) return 'Tomorrow';
	if (diff === -1) return 'Yesterday';
	if (diff < 0) return `Was ${dayOfWeekLabel(date)} ${dayNumber(date)} ${monthShort(date)}`;
	return `${dayOfWeekLabel(date)} ${dayNumber(date)} ${monthShort(date)}`;
}

export function durationLabel(minutes: number): string {
	if (minutes < 60) return `${minutes}m`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m ? `${h}h ${m}m` : `${h}h`;
}

export function clockLabel(instant: Date, timeZone = deviceTimeZone()): string {
	const wall = instantToWall(instant, timeZone);
	return `${wall.slice(11, 13)}:${wall.slice(14, 16)}`;
}
