import { describe, expect, it } from 'vitest';
import { looksDesigned } from './looksDesigned';

describe('looksDesigned', () => {
	it('treats mail without its own backgrounds as plain', () => {
		expect(looksDesigned('<p>Hi Ada,</p><blockquote>earlier</blockquote>')).toBe(false);
		expect(looksDesigned('<table bgcolor="#FFFFFF"><tr><td>x</td></tr></table>')).toBe(false);
		expect(looksDesigned('<div style="background-color: white !important">x</div>')).toBe(false);
		expect(looksDesigned('<div style="background: rgba(255, 255, 255, 0.5)">x</div>')).toBe(false);
		expect(looksDesigned('<div style="background:rgba(12,34,56,0)">x</div>')).toBe(false);
		expect(looksDesigned('<div style="background: transparent">x</div>')).toBe(false);
	});

	it('spots painted backgrounds from attributes and css', () => {
		expect(looksDesigned('<table bgcolor="#1d2b4f"><tr><td>x</td></tr></table>')).toBe(true);
		expect(looksDesigned('<td background="hero.png">x</td>')).toBe(true);
		expect(looksDesigned('<div style="background-color:#f4f4f4">x</div>')).toBe(true);
		expect(looksDesigned('<style>.hero{background-image:url(cid:a)}</style>')).toBe(true);
		expect(looksDesigned('<div style="BACKGROUND: #000">x</div>')).toBe(true);
	});
});
