import { i18n } from './locale.svelte';

export function intlLocale(english = 'en'): string {
	return i18n.locale === 'en' ? english : i18n.tag;
}

export function dateParts(
	date: Date,
	options: Intl.DateTimeFormatOptions
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
	const parts: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
	for (const part of new Intl.DateTimeFormat(i18n.tag, options).formatToParts(date)) {
		if (part.type !== 'literal') parts[part.type] = part.value;
	}
	return parts;
}

export function weekdayName(sundayIndex: number, style: 'long' | 'short' | 'narrow'): string {
	return new Intl.DateTimeFormat(intlLocale('en-GB'), { weekday: style, timeZone: 'UTC' }).format(
		new Date(Date.UTC(2024, 0, 7 + sundayIndex))
	);
}

export function weekdayNames(style: 'long' | 'short' | 'narrow', startsOnMonday: boolean): string[] {
	const order = startsOnMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
	return order.map((day) => weekdayName(day, style));
}
