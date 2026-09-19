import { i18n } from '$core/i18n/locale.svelte';
import type { LadderPosition, LifecycleDates } from './types';

export const MS_PER_DAY = 86_400_000;

export function addDays(d: Date, n: number): number {
	return d.getTime() + n * MS_PER_DAY;
}

export function shiftDays(d: Date, n: number): Date {
	return new Date(addDays(d, n));
}

export function daysBetween(from: Date, to: Date): number {
	return Math.floor((from.getTime() - to.getTime()) / MS_PER_DAY);
}

const format = (options: Intl.DateTimeFormatOptions) => (d: Date) =>
	new Intl.DateTimeFormat(i18n.tag, options).format(d);

export const fmt = {
	full: format({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }),
	med: format({ weekday: 'short', day: 'numeric', month: 'short' }),
	short: format({ day: 'numeric', month: 'short' })
};

export function ladderFor(now: Date, dates: LifecycleDates): LadderPosition {
	return {
		day: Math.max(0, daysBetween(now, dates.end)),
		toSuspend: Math.max(0, daysBetween(dates.suspend, now)),
		toDelete: Math.max(0, daysBetween(dates.remove, now))
	};
}
