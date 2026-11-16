import { describe, expect, it } from 'vitest';
import type { Highlight } from './compile';
import { EXCERPT_CHARS, highlight, type ExcerptPart } from './excerpt';
import { Field } from './types';

const ALL = [Field.subject, Field.participant, Field.body, Field.quoted, Field.signature, Field.attachmentName, Field.attachmentText];

function words(text: string, fields: readonly Field[] = ALL): Highlight {
	return { kind: 'words', text, fields };
}

function body(text: string, field: Field = Field.body): ExcerptPart {
	return { field, text, attachmentId: null, locator: null };
}

function marked(text: string, spans: { start: number; end: number }[]): string[] {
	return spans.map((s) => text.slice(s.start, s.end));
}

describe('highlight', () => {
	it('marks every occurrence of a word without regard to case or accents', () => {
		const h = highlight(null, [body('Café receipt. The CAFE was closed, cafe owner called.')], [words('cafe')]);
		expect(h.excerpt?.field).toBe(Field.body);
		expect(marked(h.excerpt!.text, h.excerpt!.spans)).toEqual(['Café', 'CAFE', 'cafe']);
	});

	it('marks a phrase only where the words are adjacent and in order', () => {
		const text = 'invoice for the hotel, then hotel invoice attached';
		const h = highlight(null, [body(text)], [words('hotel invoice')]);
		expect(marked(h.excerpt!.text, h.excerpt!.spans)).toEqual(['hotel invoice']);
	});

	it('marks whole words for a prefix', () => {
		const h = highlight(null, [body('Invoices and invoicing, not an invite')], [{ kind: 'prefix', text: 'invo', fields: ALL }]);
		expect(marked(h.excerpt!.text, h.excerpt!.spans)).toEqual(['Invoices', 'invoicing']);
	});

	it('marks a punctuated identifier literally', () => {
		const h = highlight(null, [body('Ref AB-19/007 and AB-19/008')], [{ kind: 'literal', text: 'ab-19/007', fields: ALL }]);
		expect(marked(h.excerpt!.text, h.excerpt!.spans)).toEqual(['AB-19/007']);
	});

	it('keeps right-to-left text intact around a match', () => {
		const text = 'مرحبا فاتورة الفندق شكرا';
		const h = highlight(null, [body(text)], [words('فاتورة')]);
		expect(h.excerpt!.text).toBe(text);
		expect(marked(h.excerpt!.text, h.excerpt!.spans)).toEqual(['فاتورة']);
	});

	it('marks the subject separately and reports both fields', () => {
		const h = highlight('Hotel invoice', [body('Please find the hotel bill')], [words('hotel')]);
		expect(marked('Hotel invoice', h.subject)).toEqual(['Hotel']);
		expect(h.fields).toEqual([Field.subject, Field.body]);
	});

	it('ignores fields the query did not search', () => {
		const h = highlight('Budget', [body('budget numbers')], [words('budget', [Field.subject])]);
		expect(h.fields).toEqual([Field.subject]);
		expect(h.excerpt?.field).toBeNull();
		expect(h.excerpt?.spans).toEqual([]);
	});

	it('prefers body over attachment text and names the attachment page', () => {
		const parts: ExcerptPart[] = [
			{ field: Field.attachmentText, text: 'quarterly forecast table', attachmentId: 'a1', locator: 4 },
			body('nothing relevant here')
		];
		const h = highlight(null, parts, [words('forecast')]);
		expect(h.excerpt).toMatchObject({ field: Field.attachmentText, attachmentId: 'a1', locator: 4 });
	});

	it('clips long text around the first match and keeps spans aligned', () => {
		const filler = 'lorem ipsum dolor sit amet '.repeat(30);
		const text = `${filler}the needle sits here ${filler}`;
		const h = highlight(null, [body(text)], [words('needle')]);
		expect(h.excerpt!.text.length).toBeLessThanOrEqual(EXCERPT_CHARS);
		expect(h.excerpt!.clippedStart).toBe(true);
		expect(h.excerpt!.clippedEnd).toBe(true);
		expect(marked(h.excerpt!.text, h.excerpt!.spans)).toEqual(['needle']);
	});

	it('collapses whitespace without moving the marks', () => {
		const h = highlight(null, [body('line one\n\n   the   target\tword')], [words('target')]);
		expect(h.excerpt!.text).toBe('line one the target word');
		expect(marked(h.excerpt!.text, h.excerpt!.spans)).toEqual(['target']);
	});

	it('falls back to the body preview when only metadata matched', () => {
		const h = highlight('Hello', [body('the preview text')], []);
		expect(h.excerpt).toMatchObject({ text: 'the preview text', spans: [], field: null });
	});
});
