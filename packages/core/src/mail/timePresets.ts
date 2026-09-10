export interface TimePreset {
	id: string;
	label: string;
	when: Date;
}

export interface TimeBounds {
	now: Date;
	min: Date;
	max: Date;
}

export type TimeRangeError = 'invalid' | 'past' | 'too_soon' | 'too_far';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export const MORNING_HOUR = 8;
export const AFTERNOON_HOUR = 13;
export const EVENING_HOUR = 18;

export const SNOOZE_MIN_LEAD_MS = MINUTE_MS;
export const SNOOZE_MAX_DAYS = 365;
export const SCHEDULE_MIN_LEAD_MS = 2 * MINUTE_MS;
export const SCHEDULE_MAX_DAYS = 30;

const SATURDAY = 6;
const MONDAY = 1;

function atTime(base: Date, hour: number): Date {
	const d = new Date(base.getTime());
	d.setHours(hour, 0, 0, 0);
	return d;
}

function addDays(base: Date, days: number): Date {
	const d = new Date(base.getTime());
	d.setDate(d.getDate() + days);
	return d;
}

export function todayAt(now: Date, hour: number): Date {
	return atTime(now, hour);
}

export function tomorrowAt(now: Date, hour: number): Date {
	return atTime(addDays(now, 1), hour);
}

export function nextWeekdayAt(now: Date, weekday: number, hour: number): Date {
	const base = atTime(now, hour);
	const delta = (weekday - base.getDay() + 7) % 7 || 7;
	return addDays(base, delta);
}

export function snoozeBounds(now: Date = new Date()): TimeBounds {
	return {
		now,
		min: new Date(now.getTime() + SNOOZE_MIN_LEAD_MS),
		max: new Date(now.getTime() + SNOOZE_MAX_DAYS * DAY_MS)
	};
}

export function scheduleBounds(now: Date = new Date()): TimeBounds {
	return {
		now,
		min: new Date(now.getTime() + SCHEDULE_MIN_LEAD_MS),
		max: new Date(now.getTime() + SCHEDULE_MAX_DAYS * DAY_MS)
	};
}

export function validateWhen(
	when: Date | null | undefined,
	bounds: TimeBounds
): TimeRangeError | null {
	if (!when || Number.isNaN(when.getTime())) return 'invalid';
	const t = when.getTime();
	if (t <= bounds.now.getTime()) return 'past';
	if (t < bounds.min.getTime()) return 'too_soon';
	if (t > bounds.max.getTime()) return 'too_far';
	return null;
}

function inBounds(when: Date, bounds: TimeBounds): boolean {
	return validateWhen(when, bounds) === null;
}

export function snoozePresets(now: Date = new Date()): TimePreset[] {
	const bounds = snoozeBounds(now);
	const day = now.getDay();
	const candidates: TimePreset[] = [
		{ id: 'later-today', label: 'Later today', when: todayAt(now, EVENING_HOUR) },
		{ id: 'tomorrow', label: 'Tomorrow', when: tomorrowAt(now, MORNING_HOUR) }
	];
	if (day !== 0 && day !== SATURDAY) {
		candidates.push({
			id: 'this-weekend',
			label: 'This weekend',
			when: nextWeekdayAt(now, SATURDAY, MORNING_HOUR)
		});
	}
	candidates.push({
		id: 'next-week',
		label: 'Next week',
		when: nextWeekdayAt(now, MONDAY, MORNING_HOUR)
	});
	return candidates.filter((p) => inBounds(p.when, bounds));
}

export function schedulePresets(now: Date = new Date()): TimePreset[] {
	const bounds = scheduleBounds(now);
	const candidates: TimePreset[] = [
		{ id: 'later-today', label: 'Later today', when: todayAt(now, EVENING_HOUR) },
		{ id: 'tomorrow-morning', label: 'Tomorrow morning', when: tomorrowAt(now, MORNING_HOUR) },
		{
			id: 'tomorrow-afternoon',
			label: 'Tomorrow afternoon',
			when: tomorrowAt(now, AFTERNOON_HOUR)
		},
		{
			id: 'monday-morning',
			label: 'Monday morning',
			when: nextWeekdayAt(now, MONDAY, MORNING_HOUR)
		}
	];
	return candidates.filter((p) => inBounds(p.when, bounds));
}

export function toLocalInput(d: Date): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseLocalInput(value: string): Date | null {
	if (!value.trim()) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

export function returnedFromSnooze(
	m: { folder: string; unread: boolean; snoozedUntil?: string | null },
	nowMs: number
): boolean {
	if (!m.snoozedUntil) return false;
	if (!m.unread) return false;
	if (m.folder !== 'inbox') return false;
	const t = Date.parse(m.snoozedUntil);
	return Number.isFinite(t) && t <= nowMs;
}
