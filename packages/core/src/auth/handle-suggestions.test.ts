import { describe, expect, it } from 'vitest';
import { handleSuggestions } from './handle-suggestions';

describe('handleSuggestions', () => {
	it('offers variants of a taken handle', () => {
		expect(handleSuggestions('ada')).toEqual(['ada.mail', 'adamail', 'ada.post']);
	});

	it('drops trailing separators before building variants', () => {
		expect(handleSuggestions('ada.')).toEqual(['ada.mail', 'adamail', 'ada.post']);
	});

	it('never suggests the handle itself', () => {
		expect(handleSuggestions('ada.mail')).toEqual(['ada.mail.mail', 'ada.mailmail', 'ada.mail.post']);
		expect(handleSuggestions('-')).toEqual([]);
	});
});
