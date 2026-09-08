import { describe, expect, it } from 'vitest';
import { excerptFor, parseTerms, scoreText } from './query';
import type { IndexedText } from './types';

function text(over: Partial<IndexedText> = {}): IndexedText {
	return {
		id: 'm1',
		subject: '',
		senderDisplay: '',
		senderAddress: '',
		recipients: '',
		snippet: '',
		...over
	};
}

describe('parseTerms', () => {
	it('lowercases, strips diacritics and drops punctuation', () => {
		expect(parseTerms('Café, Invoice!')).toEqual(['cafe', 'invoice']);
	});

	it('keeps address punctuation so a sender can be searched whole', () => {
		expect(parseTerms('anna@school.pt')).toEqual(['anna@school.pt']);
	});

	it('returns nothing for a blank query', () => {
		expect(parseTerms('   ')).toEqual([]);
	});

	it('caps the number of terms', () => {
		const many = Array.from({ length: 40 }, (_, i) => `t${i}`).join(' ');
		expect(parseTerms(many)).toHaveLength(16);
	});
});

describe('scoreText', () => {
	it('ranks a subject match above a snippet match', () => {
		const subject = scoreText(text({ subject: 'Invoice 42' }), ['invoice']);
		const snippet = scoreText(text({ snippet: 'the invoice is attached' }), ['invoice']);
		expect(subject).toBeGreaterThan(snippet);
	});

	it('ranks a sender match above a recipient match', () => {
		const sender = scoreText(text({ senderDisplay: 'Anna Reis' }), ['anna']);
		const recipient = scoreText(text({ recipients: 'Anna Reis anna@x.pt' }), ['anna']);
		expect(sender).toBeGreaterThan(recipient);
	});

	it('requires every term to match somewhere', () => {
		const record = text({ subject: 'Invoice 42', snippet: 'due friday' });
		expect(scoreText(record, ['invoice', 'friday'])).toBeGreaterThan(0);
		expect(scoreText(record, ['invoice', 'monday'])).toBe(0);
	});

	it('matches a diacritic-free query against accented mail', () => {
		expect(scoreText(text({ subject: 'Reunião da escola' }), ['reuniao'])).toBeGreaterThan(0);
	});

	it('scores a word start higher than a mid-word hit', () => {
		const start = scoreText(text({ subject: 'invoice' }), ['inv']);
		const middle = scoreText(text({ subject: 'reinvoice' }), ['inv']);
		expect(start).toBeGreaterThan(middle);
	});

	it('scores nothing without terms', () => {
		expect(scoreText(text({ subject: 'Invoice' }), [])).toBe(0);
	});
});

describe('excerptFor', () => {
	it('windows the snippet around the first match', () => {
		const long = `${'a '.repeat(80)}invoice ${'b '.repeat(80)}`;
		const out = excerptFor(text({ snippet: long }), ['invoice']);
		expect(out).toContain('invoice');
		expect(out.length).toBeLessThan(long.length);
		expect(out.startsWith('…')).toBe(true);
	});

	it('falls back to the snippet when nothing matches it', () => {
		expect(excerptFor(text({ subject: 'Invoice', snippet: 'nothing' }), ['invoice'])).toBe(
			'nothing'
		);
	});
});
