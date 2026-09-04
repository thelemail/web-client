import { DAY_NUMS, DOW } from './fixtures';

export function minutes(time: string): number {
	const [h, m] = time.split(':').map(Number);
	return h * 60 + m;
}

export function shortTime(time: string): string {
	return time.replace(':00', '');
}

export function dayLabel(day: number): string {
	const dow = DOW[day];
	return dow.charAt(0) + dow.slice(1).toLowerCase();
}

export function longWhen(day: number, start: string, end: string, suffix = ''): string {
	return `${dayLabel(day)} ${DAY_NUMS[day]} June · ${start} – ${end}${suffix}`;
}

export function count(words: string[], n: number): string {
	return words[n] ?? String(n);
}
