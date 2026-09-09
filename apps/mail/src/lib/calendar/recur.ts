import ICAL from 'ical.js';
import {
	isAllDay,
	type CalendarItem,
	type Override,
	type OverridePatch,
	type WhenValue
} from './model';
import {
	addDays,
	addMinutesWall,
	dateToInstant,
	daysBetween,
	deviceTimeZone,
	wallMinutesBetween,
	wallToInstant
} from './tz';

export interface Occurrence {
	key: string;
	item: CalendarItem;
	recurrenceId: string | null;
	start: Date;
	end: Date;
	allDay: boolean;
	startWall: string;
	endWall: string;
	timeZone: string;
	title: string;
	location?: string;
	videoUrl?: string;
	notes?: string;
	done: boolean;
	patched: boolean;
}

const MAX_ITERATIONS = 5000;
export const BUSY_PAST_DAYS = 30;
export const BUSY_FUTURE_DAYS = 400;
export const MAX_BUSY_WINDOWS = 400;

function whenWall(w: WhenValue): string {
	return isAllDay(w) ? w.date : w.dateTime;
}

function zoneOf(item: CalendarItem): string {
	const start = item.start;
	if (start && !isAllDay(start) && start.timeZone) return start.timeZone;
	return deviceTimeZone();
}

export function recurrenceKey(start: WhenValue): string {
	return whenWall(start);
}

export function occurrenceKey(itemId: string, recurrenceId: string | null): string {
	return recurrenceId ? `${itemId}::${recurrenceId}` : itemId;
}

function icalTime(w: WhenValue): ICAL.Time {
	if (isAllDay(w)) return ICAL.Time.fromDateString(w.date);
	return ICAL.Time.fromDateTimeString(w.dateTime);
}

function wallOfTime(t: ICAL.Time, allDay: boolean): string {
	const s = t.toString();
	return allDay ? s.slice(0, 10) : s.length === 16 ? `${s}:00` : s.slice(0, 19);
}

function buildOccurrence(
	item: CalendarItem,
	startWall: string,
	recurrenceId: string | null,
	patch: OverridePatch | null
): Occurrence | null {
	if (!item.start || !item.end) return null;
	const allDay = isAllDay(item.start);
	const zone = zoneOf(item);
	let sWall = startWall;
	let eWall: string;
	if (allDay) {
		const span = Math.max(1, daysBetween(whenWall(item.start), whenWall(item.end)));
		eWall = addDays(sWall, span);
	} else {
		const minutes = Math.max(0, wallMinutesBetween(whenWall(item.start), whenWall(item.end)));
		eWall = addMinutesWall(sWall, minutes);
	}
	let pAllDay = allDay;
	let pZone = zone;
	if (patch?.start) {
		pAllDay = isAllDay(patch.start);
		sWall = whenWall(patch.start);
		if (!isAllDay(patch.start) && patch.start.timeZone) pZone = patch.start.timeZone;
		if (patch.end) {
			eWall = whenWall(patch.end);
		} else if (pAllDay) {
			eWall = addDays(sWall, 1);
		} else {
			const minutes = Math.max(0, wallMinutesBetween(whenWall(item.start), whenWall(item.end)));
			eWall = addMinutesWall(sWall, minutes);
		}
	} else if (patch?.end) {
		eWall = whenWall(patch.end);
	}
	const start = pAllDay ? dateToInstant(sWall, pZone) : wallToInstant(sWall, pZone);
	const end = pAllDay ? dateToInstant(eWall, pZone) : wallToInstant(eWall, pZone);
	return {
		key: occurrenceKey(item.id, recurrenceId),
		item,
		recurrenceId,
		start,
		end: end > start ? end : new Date(start.getTime() + (pAllDay ? 86400000 : 0)),
		allDay: pAllDay,
		startWall: sWall,
		endWall: eWall,
		timeZone: pZone,
		title: patch?.title ?? item.title,
		location: patch?.location ?? item.location,
		videoUrl: patch?.videoUrl ?? item.videoUrl,
		notes: patch?.notes ?? item.notes,
		done: patch?.done ?? item.done ?? false,
		patched: patch !== null && Object.keys(patch).length > 0
	};
}

function overrideFor(item: CalendarItem, recurrenceId: string): Override | undefined {
	return item.overrides?.[recurrenceId];
}

function overlaps(o: Occurrence, from: Date, to: Date): boolean {
	return o.start < to && o.end > from;
}

export function expandItem(item: CalendarItem, from: Date, to: Date): Occurrence[] {
	if (!item.start || !item.end) return [];
	if (!item.rrule) {
		const single = buildOccurrence(item, whenWall(item.start), null, null);
		return single && overlaps(single, from, to) ? [single] : [];
	}
	const allDay = isAllDay(item.start);
	const comp = new ICAL.Component('vevent');
	const dtstart = icalTime(item.start);
	comp.addPropertyWithValue('dtstart', dtstart);
	let rule: ICAL.Recur;
	try {
		rule = ICAL.Recur.fromString(item.rrule);
	} catch {
		const single = buildOccurrence(item, whenWall(item.start), null, null);
		return single && overlaps(single, from, to) ? [single] : [];
	}
	comp.addPropertyWithValue('rrule', rule);
	for (const ex of item.exdates ?? []) {
		try {
			comp.addPropertyWithValue(
				'exdate',
				allDay ? ICAL.Time.fromDateString(ex.slice(0, 10)) : ICAL.Time.fromDateTimeString(ex)
			);
		} catch {
			continue;
		}
	}
	const event = new ICAL.Event(comp);
	const iter = event.iterator();
	const out: Occurrence[] = [];
	for (let i = 0; i < MAX_ITERATIONS; i++) {
		const next = iter.next();
		if (!next) break;
		const startWall = wallOfTime(next, allDay);
		const recurrenceId = startWall;
		const ov = overrideFor(item, recurrenceId);
		if (ov && 'cancelled' in ov && ov.cancelled) continue;
		const occ = buildOccurrence(item, startWall, recurrenceId, ov ? (ov as OverridePatch) : null);
		if (!occ) continue;
		if (occ.start >= to && !ov?.start) break;
		if (overlaps(occ, from, to)) out.push(occ);
	}
	return out;
}

export function expandItems(items: Iterable<CalendarItem>, from: Date, to: Date): Occurrence[] {
	const out: Occurrence[] = [];
	for (const item of items) out.push(...expandItem(item, from, to));
	out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.key.localeCompare(b.key));
	return out;
}

export function nextOccurrenceAfter(item: CalendarItem, after: Date): Occurrence | null {
	const horizon = new Date(after.getTime() + BUSY_FUTURE_DAYS * 86400000);
	const list = expandItem(item, after, horizon).filter((o) => o.start >= after);
	return list[0] ?? null;
}

export interface BusyWindowValue {
	startsAt: string;
	endsAt: string;
}

export function busyWindows(item: CalendarItem, now = new Date()): BusyWindowValue[] {
	if (item.privacy === 'private') return [];
	if (!item.start || !item.end) return [];
	if (item.kind === 'task' && item.done) return [];
	const from = new Date(now.getTime() - BUSY_PAST_DAYS * 86400000);
	const to = new Date(now.getTime() + BUSY_FUTURE_DAYS * 86400000);
	const occurrences = expandItem(item, from, to)
		.map((o) => ({ start: o.start.getTime(), end: o.end.getTime() }))
		.sort((a, b) => a.start - b.start);
	const merged: { start: number; end: number }[] = [];
	for (const w of occurrences) {
		const last = merged[merged.length - 1];
		if (last && w.start <= last.end) {
			last.end = Math.max(last.end, w.end);
		} else {
			merged.push({ ...w });
		}
	}
	return merged.slice(0, MAX_BUSY_WINDOWS).map((w) => ({
		startsAt: new Date(w.start).toISOString(),
		endsAt: new Date(w.end).toISOString()
	}));
}

export function itemSpan(item: CalendarItem): {
	start: number;
	end: number | null;
} {
	if (!item.start || !item.end) {
		if (item.due) {
			const d = isAllDay(item.due)
				? dateToInstant(item.due.date)
				: wallToInstant(item.due.dateTime, item.due.timeZone);
			return { start: d.getTime(), end: d.getTime() + 1 };
		}
		return { start: 0, end: null };
	}
	const first = buildOccurrence(item, whenWall(item.start), null, null);
	if (!first) return { start: 0, end: null };
	if (!item.rrule) return { start: first.start.getTime(), end: first.end.getTime() };
	try {
		const rule = ICAL.Recur.fromString(item.rrule);
		if (rule.until) {
			const untilWall = wallOfTime(rule.until, isAllDay(item.start));
			const until = isAllDay(item.start)
				? dateToInstant(untilWall.slice(0, 10))
				: wallToInstant(untilWall.slice(0, 19), zoneOf(item));
			return {
				start: first.start.getTime(),
				end: until.getTime() + 86400000 * 2
			};
		}
		if (rule.count) {
			const far = new Date(first.start.getTime() + 3650 * 86400000);
			const all = expandItem(item, new Date(first.start.getTime() - 1), far);
			const last = all[all.length - 1];
			return {
				start: first.start.getTime(),
				end: last ? last.end.getTime() : null
			};
		}
	} catch {
		return { start: first.start.getTime(), end: null };
	}
	return { start: first.start.getTime(), end: null };
}
