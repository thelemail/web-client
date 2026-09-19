import { describe, expect, it } from 'vitest';
import { richSegments } from './rich';

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
