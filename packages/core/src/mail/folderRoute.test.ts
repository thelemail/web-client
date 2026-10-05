import { describe, expect, it } from 'vitest';
import {
	customFolderId,
	customFolderRoute,
	customLabelId,
	customLabelRoute,
	isMailFolderRoute
} from './folderRoute';
import { parseQuery, toggleLabel, withFilters } from './url';

const ID = '7d1f4c1e-3b2a-4c55-9a51-1f0e2d3c4b5a';

describe('custom folder routes', () => {
	it('round-trips a folder id through its route', () => {
		expect(customFolderId(customFolderRoute(ID))).toBe(ID);
	});

	it('accepts system folders and well-formed custom routes only', () => {
		expect(isMailFolderRoute('inbox')).toBe(true);
		expect(isMailFolderRoute(`f-${ID}`)).toBe(true);
		expect(isMailFolderRoute('f-not-a-uuid')).toBe(false);
		expect(isMailFolderRoute('f-')).toBe(false);
		expect(isMailFolderRoute('labels')).toBe(false);
	});

	it('parses a custom folder route into the query', () => {
		expect(parseQuery(`f-${ID}`, new URLSearchParams()).folder).toBe(`f-${ID}`);
		expect(parseQuery('f-bogus', new URLSearchParams()).folder).toBe('inbox');
	});
});

describe('label filters in the URL', () => {
	it('keeps only label ids, deduplicated and lower-cased', () => {
		const sp = new URLSearchParams({ labels: `${ID.toUpperCase()},domains,${ID}` });
		expect(parseQuery('inbox', sp).labels).toEqual([ID]);
	});

	it('toggles a label id on and off', () => {
		const on = toggleLabel(new URLSearchParams(), ID);
		expect(on).toBe(`?labels=${ID}`);
		expect(toggleLabel(new URLSearchParams(on.slice(1)), ID)).toBe('');
	});
});

describe('custom label routes', () => {
	it('round-trips a label id and keeps it apart from folders', () => {
		expect(customLabelId(customLabelRoute(ID))).toBe(ID);
		expect(customFolderId(customLabelRoute(ID))).toBeNull();
		expect(isMailFolderRoute(`l-${ID}`)).toBe(true);
		expect(isMailFolderRoute('l-nope')).toBe(false);
		expect(parseQuery(`l-${ID}`, new URLSearchParams()).folder).toBe(`l-${ID}`);
	});
});

describe('subtree scope in the URL', () => {
	it('includes descendants unless scope=direct is set', () => {
		expect(parseQuery(`f-${ID}`, new URLSearchParams()).direct).toBe(false);
		expect(parseQuery(`f-${ID}`, new URLSearchParams({ scope: 'direct' })).direct).toBe(true);
	});

	it('writes and clears the scope flag', () => {
		const on = withFilters(new URLSearchParams(), { direct: true });
		expect(on).toBe('?scope=direct');
		expect(withFilters(new URLSearchParams(on.slice(1)), { direct: false })).toBe('');
	});
});
