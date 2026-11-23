import { describe, expect, it } from 'vitest';
import { glueTrailing, richSegments } from './rich';

describe('richSegments', () => {
	it('splits tagged spans out of a sentence', () => {
		expect(richSegments('Read the <link>guide</link> first.')).toEqual([
			{ text: 'Read the ' },
			{ tag: 'link', text: 'guide' },
			{ text: ' first.' }
		]);
	});

	it('handles several tags and plain text', () => {
		expect(richSegments('<b>Note:</b> see <link>docs</link>')).toEqual([
			{ tag: 'b', text: 'Note:' },
			{ text: ' see ' },
			{ tag: 'link', text: 'docs' }
		]);
		expect(richSegments('plain')).toEqual([{ text: 'plain' }]);
	});

	it('leaves unmatched markup as text', () => {
		expect(richSegments('a <b>b</i> c')).toEqual([{ text: 'a <b>b</i> c' }]);
	});
});

describe('glueTrailing', () => {
	it('moves punctuation after a tag onto the tag', () => {
		expect(glueTrailing(richSegments('Sign in as <email></email>. Then <b>go</b>, now'))).toEqual([
			{ text: 'Sign in as ' },
			{ tag: 'email', text: '', tail: '.' },
			{ text: ' Then ' },
			{ tag: 'b', text: 'go', tail: ',' },
			{ text: ' now' }
		]);
	});

	it('keeps a French spaced colon with the tag', () => {
		expect(glueTrailing(richSegments('tapé à nouveau <c></c>\u00a0:'))).toEqual([
			{ text: 'tapé à nouveau ' },
			{ tag: 'c', text: '', tail: '\u00a0:' }
		]);
	});

	it('leaves words and plain text alone', () => {
		expect(glueTrailing(richSegments('<a></a> and more'))).toEqual([{ tag: 'a', text: '' }, { text: ' and more' }]);
		expect(glueTrailing(richSegments('plain.'))).toEqual([{ text: 'plain.' }]);
	});
});
