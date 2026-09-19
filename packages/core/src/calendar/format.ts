import { parseDate } from '@internationalized/date';
import { locale } from '$core/mail/locale.svelte';
import { m } from '$paraglide/messages.js';
import { i18n, withLocale } from '$core/i18n/locale.svelte';
import { intlLocale } from '$core/i18n/intl';
import type { Occurrence } from './recur';
import { deviceTimeZone, instantToWall } from './tz';

function utcDate(date: string): Date {
	const d = parseDate(date);
	return new Date(Date.UTC(d.year, d.month - 1, d.day));
}

function formatUtc(date: string, english: string, options: Intl.DateTimeFormatOptions): string {
	return new Intl.DateTimeFormat(intlLocale(english), { ...options, timeZone: 'UTC' }).format(
		utcDate(date)
	);
}

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
		if (i18n.locale !== 'en') {
			return new Intl.DateTimeFormat(i18n.tag, {
				hour: 'numeric',
				minute: m === 0 ? undefined : '2-digit',
				hour12: true,
				timeZone: 'UTC'
			}).format(new Date(Date.UTC(2000, 0, 1, h, m)));
		}
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
	return formatUtc(date, 'en-GB', { weekday: 'short' });
}

export function dayLabel(date: string): string {
	return dayOfWeekLabel(date);
}

export function dayNumber(date: string): number {
	return Number(date.slice(8, 10));
}

export function monthName(date: string): string {
	return formatUtc(date, 'en-GB', { month: 'long' });
}

export function monthShort(date: string): string {
	return formatUtc(date, 'en-US', { month: 'short' });
}

export function monthYearLabel(date: string): string {
	return formatUtc(date, 'en-GB', { month: 'long', year: 'numeric' });
}

export function year(date: string): number {
	return Number(date.slice(0, 4));
}

export function dateLabel(date: string, withYear = false): string {
	if (i18n.locale !== 'en') {
		return formatUtc(date, 'en-GB', {
			weekday: 'short',
			day: 'numeric',
			month: 'long',
			year: withYear ? 'numeric' : undefined
		});
	}
	const base = `${dayOfWeekLabel(date)} ${dayNumber(date)} ${monthName(date)}`;
	return withYear ? `${base} ${year(date)}` : base;
}

function shortDateLabel(date: string): string {
	if (i18n.locale !== 'en') {
		return formatUtc(date, 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
	}
	return `${dayOfWeekLabel(date)} ${dayNumber(date)} ${monthShort(date)}`;
}

export function rangeTitle(startDate: string, endDate: string): string {
	const a = parseDate(startDate);
	const b = parseDate(endDate).subtract({ days: 1 });
	if (i18n.locale !== 'en') {
		const sameMonth = a.month === b.month;
		return new Intl.DateTimeFormat(i18n.tag, {
			day: 'numeric',
			month: sameMonth ? 'long' : 'short',
			timeZone: 'UTC'
		}).formatRange(utcDate(startDate), utcDate(b.toString()));
	}
	if (a.month === b.month) return `${a.day} – ${b.day} ${monthName(startDate)}`;
	return `${a.day} ${monthShort(startDate)} – ${b.day} ${monthShort(endDate)}`;
}

export function longWhen(
	occ: Occurrence,
	timeZone = deviceTimeZone(),
	outgoing = false
): string {
	if (outgoing) return withLocale('en', () => longWhen(occ, timeZone));
	if (occ.allDay) {
		const startDate = occ.startWall.slice(0, 10);
		const lastDate = parseDate(occ.endWall.slice(0, 10)).subtract({ days: 1 });
		const last = `${lastDate.year}-${String(lastDate.month).padStart(2, '0')}-${String(lastDate.day).padStart(2, '0')}`;
		if (last <= startDate) return m.cal_fmt_all_day({ date: dateLabel(startDate) });
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
	if (diff === 0) return m.cal_fmt_today();
	if (diff === 1) return m.cal_fmt_tomorrow();
	if (diff === -1) return m.cal_fmt_yesterday();
	if (diff < 0) return m.cal_fmt_was({ date: shortDateLabel(date) });
	return shortDateLabel(date);
}

export function durationLabel(minutes: number): string {
	if (minutes < 60) return m.cal_fmt_minutes_short({ minutes });
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest ? m.cal_fmt_hours_minutes_short({ hours, minutes: rest }) : m.cal_fmt_hours_short({ hours });
}

export function clockLabel(instant: Date, timeZone = deviceTimeZone()): string {
	const wall = instantToWall(instant, timeZone);
	return `${wall.slice(11, 13)}:${wall.slice(14, 16)}`;
}
