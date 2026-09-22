import { afterEach, describe, expect, it } from 'vitest';
import { formatMoment, timeSince, timeUntil } from './relative';
import { withLocale } from './locale.svelte';
import { recordServerDate, resetServerClock } from '$core/api/serverclock';

const NOW = Date.parse('2026-09-22T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

afterEach(() => {
	resetServerClock();
});

describe('timeSince and timeUntil', () => {
	it('says just now for the last minute', () => {
		expect(timeSince(NOW - 40_000, NOW)).toBe('just now');
		expect(timeSince(iso(0), NOW)).toBe('just now');
	});

	it('counts minutes, hours and days back', () => {
		expect(timeSince(iso(-3 * MIN), NOW)).toBe('3 minutes ago');
		expect(timeSince(iso(-2 * HOUR), NOW)).toBe('2 hours ago');
		expect(timeSince(iso(-DAY), NOW)).toBe('yesterday');
		expect(timeSince(iso(-3 * DAY), NOW)).toBe('3 days ago');
	});

	it('counts forward for what is still to come', () => {
		expect(timeUntil(iso(20_000), NOW)).toBe('in a moment');
		expect(timeUntil(iso(5 * MIN), NOW)).toBe('in 5 minutes');
		expect(timeUntil(iso(3 * HOUR), NOW)).toBe('in 3 hours');
		expect(timeUntil(iso(DAY), NOW)).toBe('tomorrow');
		expect(timeUntil(iso(2 * DAY), NOW)).toBe('in 2 days');
	});

	it('never flips direction', () => {
		expect(timeSince(NOW + 5 * MIN, NOW)).toBe('just now');
		expect(timeUntil(NOW - 5 * MIN, NOW)).toBe('in a moment');
	});

	it('measures against the server clock by default', () => {
		recordServerDate(new Date(Date.now() + 2 * HOUR).toUTCString());
		expect(timeSince(Date.now() + 2 * HOUR)).toBe('just now');
		expect(timeSince(Date.now() + 2 * HOUR - 5 * MIN)).toBe('5 minutes ago');
		expect(timeUntil(Date.now() + 2 * HOUR + 10 * MIN)).toBe('in 10 minutes');
	});

	it('follows the interface language', () => {
		withLocale('de', () => {
			expect(timeSince(iso(-5 * MIN), NOW)).toBe('vor 5 Minuten');
			expect(timeUntil(iso(5 * MIN), NOW)).toBe('in 5 Minuten');
		});
	});

	it('returns nothing for an unreadable time', () => {
		expect(timeSince('nope')).toBe('');
		expect(timeUntil('nope')).toBe('');
	});
});

describe('formatMoment', () => {
	it('formats the moment in the interface language', () => {
		const t = NOW - 3 * DAY;
		expect(formatMoment(iso(-3 * DAY))).toBe(
			new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(t)
		);
		withLocale('fr', () => {
			expect(formatMoment(t)).toBe(
				new Intl.DateTimeFormat('fr', { dateStyle: 'medium', timeStyle: 'short' }).format(t)
			);
		});
	});

	it('returns nothing for an unreadable time', () => {
		expect(formatMoment('nope')).toBe('');
	});
});
