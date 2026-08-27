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

const full = new Intl.DateTimeFormat(undefined, {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	year: 'numeric'
});
const med = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const short = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

export const fmt = {
	full: (d: Date) => full.format(d),
	med: (d: Date) => med.format(d),
	short: (d: Date) => short.format(d)
};

export function ladderFor(now: Date, dates: LifecycleDates): LadderPosition {
	return {
		day: Math.max(0, daysBetween(now, dates.trialEnd)),
		toSuspend: Math.max(0, daysBetween(dates.suspend, now)),
		toDelete: Math.max(0, daysBetween(dates.remove, now))
	};
}
