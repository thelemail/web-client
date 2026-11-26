import { i18n } from './locale.svelte';

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

export function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${locale}|${JSON.stringify(options)}`;
	let format = dateFormats.get(key);
	if (!format) {
		format = new Intl.DateTimeFormat(locale, options);
		dateFormats.set(key, format);
	}
	return format;
}

export function formatNumber(n: number, options: Intl.NumberFormatOptions = {}): string {
	const key = JSON.stringify(options);
	let format = numberFormats.get(key);
	if (!format) {
		format = new Intl.NumberFormat(undefined, options);
		numberFormats.set(key, format);
	}
	return format.format(n);
}

export function intlLocale(english = 'en'): string {
	return i18n.locale === 'en' ? english : i18n.tag;
}

export function dateParts(
	date: Date,
	options: Intl.DateTimeFormatOptions
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
	const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
	for (const part of dateFormat(i18n.tag, options).formatToParts(date)) {
		if (part.type !== 'literal') parts[part.type] = part.value;
	}
	return parts;
}

export function weekdayName(sundayIndex: number, style: 'long' | 'short' | 'narrow'): string {
	return dateFormat(intlLocale('en-GB'), { weekday: style, timeZone: 'UTC' }).format(
		new Date(Date.UTC(2024, 0, 7 + sundayIndex))
	);
}

export function weekdayNames(style: 'long' | 'short' | 'narrow', startsOnMonday: boolean): string[] {
	const order = startsOnMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
	return order.map((day) => weekdayName(day, style));
}
