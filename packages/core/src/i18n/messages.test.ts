import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import de from '../../messages/de.json';
import fr from '../../messages/fr.json';
import pt from '../../messages/pt.json';

const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => k !== '$schema').sort();

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
});
