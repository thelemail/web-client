import { describe, expect, it } from 'vitest';
import { allowedEdits } from './suggest';
import { bounded, compareCodePoints, editDistance, extension, significant } from './functions';
import { nearWithin } from './tokenizer';

describe('bounded', () => {
	it('matches whole identifiers only', () => {
		expect(bounded('Case AB-19/007 is closed.', 'ab-19/007')).toBe(true);
		expect(bounded('Case AB-19/0071 is open.', 'ab-19/007')).toBe(false);
		expect(bounded('Case XAB-19/007.', 'ab-19/007')).toBe(false);
		expect(bounded('ref INV-2026-0042-b', 'inv-2026-0042')).toBe(false);
		expect(bounded('ref INV-2026-0042.', 'inv-2026-0042')).toBe(true);
		expect(bounded('(PO#5512)', 'po#5512')).toBe(true);
		expect(bounded('<m1@calloway.test>', 'm1@calloway.test')).toBe(true);
		expect(bounded(null, 'x')).toBe(false);
	});

	it('treats regular expression syntax in the needle literally', () => {
		expect(bounded('cost (a+b)*c', 'a+b')).toBe(true);
		expect(bounded('aab', 'a+b')).toBe(false);
	});
});

describe('helpers', () => {
	it('rounds to twelve significant digits', () => {
		expect(significant(0.1 + 0.2)).toBe(0.3);
		expect(significant(1.23456789012345e-7)).toBe(1.23456789012e-7);
		expect(significant(0)).toBe(0);
	});

	it('bounds edit distance', () => {
		expect(editDistance([...'invoce'], [...'invoice'], 1)).toBe(1);
		expect(editDistance([...'kitten'], [...'sitting'], 2)).toBe(3);
		expect(editDistance([...'東京'], [...'京都'], 2)).toBe(2);
		expect([3, 4, 7, 8, 32, 33].map(allowedEdits)).toEqual([0, 1, 1, 2, 2, 0]);
	});

	it('orders by code point', () => {
		expect(compareCodePoints('\u{1F600}', '￿')).toBe(1);
		expect(compareCodePoints('a', 'ab')).toBe(-1);
	});

	it('reads extensions', () => {
		expect(extension('Photo.JPG')).toBe('jpg');
		expect(extension('.bashrc')).toBe('');
		expect(extension('archive.')).toBe('');
	});
});

describe('nearWithin', () => {
	const tokens = 'alpha beta alpha gamma red green blue'.split(' ');

	it('needs distinct, non-overlapping occurrences', () => {
		expect(nearWithin(tokens, ['alpha'], ['alpha'], 1)).toBe(true);
		expect(nearWithin(tokens, ['alpha'], ['alpha'], 0)).toBe(false);
		expect(nearWithin(tokens, ['red', 'green'], ['green', 'blue'], 5)).toBe(false);
		expect(nearWithin(tokens, ['red'], ['blue'], 1)).toBe(true);
		expect(nearWithin(tokens, ['blue'], ['red'], 0)).toBe(false);
	});
});
