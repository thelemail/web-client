import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import de from '../../messages/de.json';
import fr from '../../messages/fr.json';
import pt from '../../messages/pt.json';

const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => k !== '$schema').sort();

const catalogues = [
	['en', en],
	['de', de],
	['fr', fr],
	['pt', pt]
] as const;

function strings(catalogue: Record<string, unknown>, pick: (key: string) => boolean): [string, string][] {
	return Object.entries(catalogue)
		.filter(([k]) => pick(k))
		.map(([k, v]) => [k, JSON.stringify(v)]);
}

const isSettings = (k: string) => k.startsWith('settings_') || /(^|_)page_title(_|$)/.test(k);
const isPasskey = (k: string) => k.startsWith('settings_') || k.startsWith('auth_2fa_');

const unsupportedPasskeyClaims = [
	/Touch ID|Face ID|Windows Hello/,
	/stays on this device|bleibt auf diesem Gerät|reste sur cet appareil|fica neste dispositivo/,
	/PIN (each|every) time|jeder Anmeldung nach seiner PIN|PIN à chaque|PIN sempre/,
	/USB port|USB-Anschluss|ports USB|porta USB|NFC/
];

describe('message catalogues', () => {
	it.each([
		['de', de],
		['fr', fr],
		['pt', pt]
	])('%s has exactly the English keys', (_, catalogue) => {
		const base = keys(en);
		const other = keys(catalogue);
		expect(base.filter((k) => !other.includes(k))).toEqual([]);
		expect(other.filter((k) => !base.includes(k))).toEqual([]);
	});

	it.each([
		['en', en],
		['de', de],
		['fr', fr],
		['pt', pt]
	])('%s has no empty settings strings', (_, catalogue) => {
		const empty = Object.entries(catalogue as Record<string, unknown>)
			.filter(([k, v]) => k.startsWith('settings_') && typeof v === 'string' && v.trim() === '')
			.map(([k]) => k);
		expect(empty).toEqual([]);
	});

	it.each(catalogues)('%s has no em dash in settings strings or page titles', (_, catalogue) => {
		const dashed = strings(catalogue, isSettings)
			.filter(([, v]) => v.includes('\u2014'))
			.map(([k]) => k);
		expect(dashed).toEqual([]);
	});

	it.each(catalogues)('%s makes no passkey claim that only holds on some devices', (_, catalogue) => {
		const claims = strings(catalogue, isPasskey)
			.filter(([, v]) => unsupportedPasskeyClaims.some((re) => re.test(v)))
			.map(([k]) => k);
		expect(claims).toEqual([]);
	});

	it.each(catalogues)('%s uses one separator in every page title', (_, catalogue) => {
		const titles = strings(catalogue, (k) => /(^|_)page_title(_|$)/.test(k));
		expect(titles.length).toBeGreaterThan(0);
		expect(titles.filter(([, v]) => !v.includes('Thelemail \u00b7 ')).map(([k]) => k)).toEqual([]);
	});
});
