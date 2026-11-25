import { describe, expect, it } from 'vitest';
import { Field } from '../sqlite/types';
import { chunk, modelInput, RECIPE, units, type SourcePart } from './recipe';

const specials = { cls: 0, sep: 2 };
const vocab = new Map<string, number>();

function tokenize(text: string): number[] {
	return text
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => {
			let id = vocab.get(w);
			if (id === undefined) {
				id = vocab.size + 10;
				vocab.set(w, id);
			}
			return id;
		});
}

function part(text: string, overrides: Partial<SourcePart> = {}): SourcePart {
	return { ordinal: 0, field: Field.body, text, attachmentId: null, place: null, ...overrides };
}

function sentences(n: number, words = 10, tag = 's'): string {
	return Array.from({ length: n }, (_, i) => `${Array.from({ length: words - 1 }, (_, w) => `${tag}${i}w${w}`).join(' ')} end${i}.`).join(' ');
}

describe('units', () => {
	it('splits paragraphs and sentences and keeps offsets into the text', () => {
		const text = 'First one. Second one!\n\nThird paragraph here';
		const out = units(text).map((u) => text.slice(u.start, u.end));
		expect(out).toEqual(['First one.', 'Second one!', 'Third paragraph here']);
	});

	it('does not split hard-wrapped lines inside a sentence', () => {
		const text = 'This sentence wraps\nonto a second line.';
		expect(units(text).map((u) => text.slice(u.start, u.end))).toEqual([text]);
	});
});

describe('chunk', () => {
	it('prefixes passage and context and stays inside the token budget', () => {
		const r = chunk('Quarterly budget', [part('Short body.')], tokenize, specials);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const [p] = r.passages;
		expect(p.ids[0]).toBe(specials.cls);
		expect(p.ids[p.ids.length - 1]).toBe(specials.sep);
		expect(p.ids.slice(1, 2)).toEqual(tokenize(RECIPE.prefix));
		expect(p.refs).toEqual([{ part: 0, start: 0, end: 11 }]);
	});

	it('caps the subject context at 48 tokens', () => {
		const subject = Array.from({ length: 100 }, (_, i) => `subj${i}`).join(' ');
		const r = chunk(subject, [part('Body.')], tokenize, specials);
		if (!r.ok) throw new Error('chunk');
		expect(r.passages[0].ids.length).toBe(2 + tokenize(RECIPE.prefix).length + RECIPE.context + 1);
	});

	it('covers the start, middle and end of a long body with overlapping passages under 512 tokens', () => {
		const text = sentences(300);
		const r = chunk('Subject', [part(text)], tokenize, specials);
		if (!r.ok) throw new Error('chunk');
		expect(r.passages.length).toBeGreaterThan(5);
		for (const p of r.passages) expect(p.ids.length).toBeLessThanOrEqual(RECIPE.total);
		const covered = (word: string) => r.passages.some((p) => p.ids.includes(tokenize(word)[0]));
		expect(covered('s0w0')).toBe(true);
		expect(covered('s150w0')).toBe(true);
		expect(covered('s299w0')).toBe(true);
		const first = new Set(r.passages[0].ids);
		const shared = r.passages[1].ids.filter((id) => id > 9 && first.has(id) && !tokenize('Subject').includes(id));
		expect(shared.length).toBeGreaterThan(0);
		expect(shared.length).toBeLessThanOrEqual(RECIPE.overlap);
	});

	it('splits a single sentence longer than the content budget without dropping text', () => {
		const words = Array.from({ length: 1000 }, (_, i) => `x${i}`);
		const r = chunk(null, [part(words.join(' '))], tokenize, specials);
		if (!r.ok) throw new Error('chunk');
		const seen = new Set(r.passages.flatMap((p) => p.ids));
		for (const w of words) expect(seen.has(tokenize(w)[0])).toBe(true);
		for (const p of r.passages) expect(p.ids.length).toBeLessThanOrEqual(RECIPE.total);
	});

	it('stores an exact repeated passage once and keeps every occurrence', () => {
		const signature = 'Best regards, Ana. Sent from the office.';
		const r = chunk(null, [part('Hello there.'), part(signature, { ordinal: 1, field: Field.signature }), part(signature, { ordinal: 2, field: Field.signature })], tokenize, specials);
		if (!r.ok) throw new Error('chunk');
		expect(r.passages).toHaveLength(2);
		expect(r.passages[1].refs.map((x) => x.part)).toEqual([1, 2]);
	});

	it('chunks each attachment on its own and keeps its first place', () => {
		const r = chunk(
			null,
			[
				part('Body text.'),
				part('Page one text.', { ordinal: 1, field: Field.attachmentText, attachmentId: 'a', place: 'page:1' }),
				part('Page two text.', { ordinal: 2, field: Field.attachmentText, attachmentId: 'a', place: 'page:2' }),
				part('Other file.', { ordinal: 3, field: Field.attachmentText, attachmentId: 'b', place: 'body' })
			],
			tokenize,
			specials
		);
		if (!r.ok) throw new Error('chunk');
		expect(r.passages.map((p) => [p.field, p.attachmentId, p.place])).toEqual([
			[Field.body, null, null],
			[Field.attachmentText, 'a', 'page:1'],
			[Field.attachmentText, 'b', 'body']
		]);
		expect(r.passages[1].refs.map((x) => x.part)).toEqual([1, 2]);
	});

	it('skips fields that carry no prose', () => {
		const r = chunk('S', [part('<id@x>', { field: Field.identifier }), part('   ')], tokenize, specials);
		expect(r).toEqual({ ok: true, passages: [] });
	});

	it('refuses a message with too many passages', () => {
		const huge = Array.from({ length: RECIPE.maxPassages + 1 }, (_, i) => sentences(1, 300, `p${i}_`)).join('\n\n');
		expect(chunk(null, [part(huge)], tokenize, specials)).toEqual({ ok: false, reason: 'tooMany' });
	});

	it('rejects content over the budget', () => {
		expect(() => modelInput(specials, [1], [], new Array(RECIPE.content + 1).fill(5))).toThrow(RangeError);
	});
});
