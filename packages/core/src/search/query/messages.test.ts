import { describe, expect, it } from 'vitest';
import { withLocale } from '$core/i18n/locale.svelte';
import type { QueryErrorCode } from './ast';
import { queryErrorMessage } from './messages';

const CODES: QueryErrorCode[] = [
	'too_long',
	'too_many_nodes',
	'too_deep',
	'unterminated_quote',
	'unbalanced_paren',
	'empty_group',
	'empty_phrase',
	'dangling_operator',
	'unsupported_filter',
	'gmail_only',
	'missing_value',
	'invalid_value',
	'invalid_date',
	'invalid_size',
	'invalid_relative',
	'invalid_wildcard',
	'prefix_too_short',
	'around_distance',
	'around_operand',
	'literal_operand',
	'nested_scope',
	'unavailable',
	'unknown_folder',
	'unknown_label'
];

const range = { start: 0, end: 1 };

describe('queryErrorMessage', () => {
	it.each(['en', 'de', 'fr', 'pt'] as const)('has a message for every code in %s', (locale) => {
		withLocale(locale, () => {
			for (const code of CODES) {
				const text = queryErrorMessage({ code, range, name: 'frm:' });
				expect(text, code).toBeTruthy();
				expect(text, code).not.toContain('search_query_error');
			}
		});
	});

	it('names the filter and offers the hint', () => {
		withLocale('en', () => {
			expect(queryErrorMessage({ code: 'unsupported_filter', range, name: 'frm:', hint: 'from:' })).toBe(
				'frm: is not a search filter. Did you mean from:?'
			);
			expect(queryErrorMessage({ code: 'gmail_only', range, name: 'is:snoozed', hint: 'in:snoozed' })).toBe(
				'is:snoozed is a Gmail feature that Thelemail does not have. Try in:snoozed instead.'
			);
		});
	});

	it('localizes', () => {
		const de = withLocale('de', () => queryErrorMessage({ code: 'unknown_label', range, name: 'Steuer' }));
		expect(de).toBe('Es gibt kein Label namens Steuer.');
	});
});
