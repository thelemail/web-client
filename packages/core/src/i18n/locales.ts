export const LOCALES = ['en', 'de', 'fr', 'pt'] as const;

export type AppLocale = (typeof LOCALES)[number];

export const BASE_LOCALE: AppLocale = 'en';

export const LOCALE_NAMES: Record<AppLocale, string> = {
	en: 'English',
	de: 'Deutsch',
	fr: 'Français',
	pt: 'Português'
};

const LANGUAGE_TAGS: Record<AppLocale, string> = {
	en: 'en',
	de: 'de',
	fr: 'fr',
	pt: 'pt-PT'
};

export function isAppLocale(value: unknown): value is AppLocale {
	return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function languageTag(locale: AppLocale): string {
	return LANGUAGE_TAGS[locale];
}

export function matchLocale(tags: readonly string[]): AppLocale | undefined {
	for (const tag of tags) {
		const [language, ...rest] = tag.trim().toLowerCase().replaceAll('_', '-').split('-');
		if (language === 'en' || language === 'de' || language === 'fr') return language;
		if (language === 'pt') {
			if (rest[0] === undefined || rest[0] === 'pt') return 'pt';
		}
	}
	return undefined;
}
