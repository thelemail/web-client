import { serverNow } from '$core/api/serverclock';
import { m } from '$paraglide/messages.js';
import { i18n } from './locale.svelte';

const MINUTE_MS = 60_000;

function toMillis(at: string | number): number {
	return typeof at === 'number' ? at : Date.parse(at);
}

function relative(diffMs: number): string {
	const rtf = new Intl.RelativeTimeFormat(i18n.tag, { numeric: 'auto' });
	const sign = Math.sign(diffMs);
	const minutes = Math.round(Math.abs(diffMs) / MINUTE_MS);
	if (minutes < 60) return rtf.format(sign * minutes, 'minute');
	const hours = Math.round(minutes / 60);
	if (hours < 24) return rtf.format(sign * hours, 'hour');
	return rtf.format(sign * Math.round(hours / 24), 'day');
}

export function timeSince(at: string | number, now: number = serverNow()): string {
	const t = toMillis(at);
	if (!Number.isFinite(t)) return '';
	const diff = t - now;
	return diff > -MINUTE_MS ? m.common_just_now() : relative(diff);
}

export function timeUntil(at: string | number, now: number = serverNow()): string {
	const t = toMillis(at);
	if (!Number.isFinite(t)) return '';
	const diff = t - now;
	return diff < MINUTE_MS ? m.common_in_a_moment() : relative(diff);
}

export function formatMoment(at: string | number): string {
	const t = toMillis(at);
	if (!Number.isFinite(t)) return '';
	return new Intl.DateTimeFormat(i18n.tag, { dateStyle: 'medium', timeStyle: 'short' }).format(t);
}
