import { describe, expect, it } from 'vitest';
import { isAppLocale, languageTag, matchLocale } from './locales';

describe('matchLocale', () => {
	it('maps regional German and French to the base language', () => {
		expect(matchLocale(['de-CH'])).toBe('de');
		expect(matchLocale(['de-AT', 'en'])).toBe('de');
		expect(matchLocale(['fr-BE'])).toBe('fr');
		expect(matchLocale(['fr_CA'])).toBe('fr');
	});

	it('only takes European Portuguese', () => {
		expect(matchLocale(['pt-PT'])).toBe('pt');
		expect(matchLocale(['pt'])).toBe('pt');
		expect(matchLocale(['pt-BR'])).toBeUndefined();
		expect(matchLocale(['pt-BR', 'fr-FR'])).toBe('fr');
		expect(matchLocale(['pt-AO', 'en-US'])).toBe('en');
	});

	it('honours preference order', () => {
		expect(matchLocale(['en-GB', 'de-DE'])).toBe('en');
		expect(matchLocale(['es-ES', 'it', 'fr'])).toBe('fr');
	});

	it('returns nothing for unsupported languages', () => {
		expect(matchLocale(['es', 'ru-RU'])).toBeUndefined();
		expect(matchLocale([])).toBeUndefined();
	});
});

describe('languageTag', () => {
	it('tags Portuguese as European', () => {
		expect(languageTag('pt')).toBe('pt-PT');
		expect(languageTag('de')).toBe('de');
	});
});

describe('isAppLocale', () => {
	it('accepts only shipped locales', () => {
		expect(isAppLocale('fr')).toBe(true);
		expect(isAppLocale('pt-BR')).toBe(false);
		expect(isAppLocale(null)).toBe(false);
	});
});
