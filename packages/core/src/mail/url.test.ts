import { describe, expect, it } from 'vitest';
import { clearFilters, parseQuery, withFilters } from './url';

describe('starred as a filter', () => {
	it('reads the starred filter on a folder', () => {
		expect(parseQuery('inbox', new URLSearchParams('starred=true')).starred).toBe(true);
	});

	it('ignores it on the Starred view itself', () => {
		expect(parseQuery('starred', new URLSearchParams('starred=true')).starred).toBe(false);
	});

	it('writes and clears it alongside the other filters', () => {
		const on = withFilters(new URLSearchParams('sort=oldest'), { starred: true });
		expect(on).toBe('?sort=oldest&starred=true');
		expect(clearFilters(new URLSearchParams(on.slice(1)))).toBe('?sort=oldest');
	});
});
