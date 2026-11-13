import { describe, expect, it } from 'vitest';
import { MAX_LITERAL, asciiDomain, domainOf, filenameLiterals, literals, normalize } from './analysis';

describe('literals', () => {
	it('keeps addresses with plus tags and their domains', () => {
		const out = literals('Write to zebulon.marsh+billing@calloway.test today');
		expect(out).toContain('zebulon.marsh+billing@calloway.test');
		expect(out).toContain('calloway.test');
	});

	it('keeps punctuation-bearing references whole', () => {
		const out = literals('Invoice INV-2026/0007 and order #A-17, ticket 4471:12.');
		expect(out).toContain('INV-2026/0007');
		expect(out).toContain('A-17');
		expect(out).toContain('4471:12');
	});

	it('keeps urls without trailing punctuation', () => {
		expect(literals('See https://calloway.test/a/b?x=1, then reply.')).toContain('https://calloway.test/a/b?x=1');
	});

	it('keeps uuids', () => {
		expect(literals('id 7F3C9E2A-1B4D-4E8F-9A0B-C1D2E3F4A5B6 end')).toContain('7F3C9E2A-1B4D-4E8F-9A0B-C1D2E3F4A5B6');
	});

	it('adds the ascii form of internationalized domains', () => {
		const out = literals('mail bücher@münchen.test now');
		expect(out).toContain('münchen.test');
		expect(out).toContain('xn--mnchen-3ya.test');
		expect(out).toContain('bücher@xn--mnchen-3ya.test');
	});

	it('routes unsegmented scripts to the literal lane', () => {
		expect(literals('会議は東京都の事務所で')).toEqual(['会議は東京都の事務所で']);
		expect(literals('สวัสดีครับ')).toEqual(['สวัสดีครับ']);
	});

	it('ignores plain words', () => {
		expect(literals('nothing special in this sentence')).toEqual([]);
	});

	it('splits very long literals into overlapping windows', () => {
		const long = `${'a1-'.repeat(3000)}z`;
		const out = literals(long);
		expect(out.every((w) => w.length <= MAX_LITERAL)).toBe(true);
		expect(out.length).toBeGreaterThan(1);
		expect(out[0].slice(-2)).toBe(out[1].slice(0, 2));
	});

	it('normalizes compatibility forms', () => {
		expect(literals('ｉｎｖ－２０２６／００７')).toContain('inv-2026/007');
	});
});

describe('helpers', () => {
	it('normalizes with NFKC', () => {
		expect(normalize('ﬁle Ⅻ')).toBe('file XII');
	});

	it('extracts lowercase domains', () => {
		expect(domainOf('Ada@Calloway.Test')).toBe('calloway.test');
		expect(domainOf('nobody')).toBe('');
	});

	it('converts only internationalized domains', () => {
		expect(asciiDomain('calloway.test')).toBeNull();
		expect(asciiDomain('münchen.test')).toBe('xn--mnchen-3ya.test');
	});

	it('indexes filenames whole and by extension', () => {
		const out = filenameLiterals('Statement-2026-10.PDF');
		expect(out).toContain('Statement-2026-10.PDF');
		expect(out).toContain('.PDF');
	});
});
