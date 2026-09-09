import { describe, it, expect } from 'vitest';
import { detectSourceKind, renderSource, htmlToMarkdown, plainToHtml } from './signatureSource';

describe('detectSourceKind', () => {
	it('recognises html', () => {
		expect(detectSourceKind('<p>Ada</p>')).toBe('html');
		expect(detectSourceKind('<div class="sig"><a href="#">x</a></div>')).toBe('html');
	});

	it('recognises markdown', () => {
		expect(detectSourceKind('## Ada')).toBe('markdown');
		expect(detectSourceKind('[site](https://example.com)')).toBe('markdown');
		expect(detectSourceKind('- one\n- two')).toBe('markdown');
		expect(detectSourceKind('**Ada Lovelace**')).toBe('markdown');
		expect(detectSourceKind('| a | b |')).toBe('markdown');
	});

	it('treats ordinary prose as plain', () => {
		expect(detectSourceKind('Ada Lovelace\nAnalytical Engines')).toBe('plain');
		expect(detectSourceKind('')).toBe('plain');
	});

	it('does not mistake a bare address for markup', () => {
		expect(detectSourceKind('Ada <ada@example.com>')).toBe('plain');
	});
});

describe('renderSource', () => {
	it('renders markdown to sanitized html', () => {
		const out = renderSource('markdown', '**Ada** and [site](https://example.com)');
		expect(out).toContain('<strong>Ada</strong>');
		expect(out).toContain('href="https://example.com"');
	});

	it('sanitizes html source', () => {
		const out = renderSource('html', '<p>Ada</p><script>steal()</script>');
		expect(out).toContain('Ada');
		expect(out).not.toContain('script');
	});

	it('sanitizes markdown that smuggles html', () => {
		const out = renderSource('markdown', 'hi <script>steal()</script>');
		expect(out).not.toContain('script');
	});

	it('returns nothing for an empty source', () => {
		expect(renderSource('markdown', '   ')).toBe('');
	});
});

describe('plainToHtml', () => {
	it('escapes markup and keeps paragraphs', () => {
		const out = plainToHtml('Ada <b>x</b>\nsecond line\n\nnext para');
		expect(out).toContain('&lt;b&gt;');
		expect(out).toContain('<br>');
		expect(out.match(/<p>/g)).toHaveLength(2);
	});
});

describe('htmlToMarkdown', () => {
	it('round-trips the common signature constructs', () => {
		const md = htmlToMarkdown('<p><strong>Ada</strong> — <a href="https://x.com">site</a></p>');
		expect(md).toContain('**Ada**');
		expect(md).toContain('[site](https://x.com)');
	});

	it('renders a markdown list back from html', () => {
		const md = htmlToMarkdown('<ul><li>one</li><li>two</li></ul>');
		expect(md).toMatch(/^-\s+one$/m);
		expect(md).toMatch(/^-\s+two$/m);
	});
});
