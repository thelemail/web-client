import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from './sanitizeHtml';

describe('sanitizeHtml', () => {
	it('drops <script> tags entirely', () => {
		const out = sanitizeHtml('<p>before</p><script>alert(1)</script><p>after</p>', {
			inlineImages: {}
		});
		expect(out).not.toContain('<script');
		expect(out).not.toContain('alert');
	});

	it('strips onerror and javascript: href', () => {
		const out = sanitizeHtml(
			'<a href="javascript:alert(1)">x</a><img src="data:image/png;base64,iVBORw" onerror="alert(1)">',
			{ inlineImages: {} }
		);
		expect(out.toLowerCase()).not.toContain('javascript:');
		expect(out.toLowerCase()).not.toContain('onerror');
	});

	it('ALWAYS drops <img src="https?:"> unconditionally (receive-time prefetch model)', () => {
		const out = sanitizeHtml(
			'<p>x</p><img src="https://tracker.example.com/pixel.gif"><img src="http://other.example/x.png">',
			{ inlineImages: {} }
		);
		expect(out).not.toContain('https://tracker.example.com');
		expect(out).not.toContain('http://other.example');
	});

	it('resolves cid: <img src> to data: URI from inlineImages', () => {
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
		const out = sanitizeHtml('<img src="cid:abc123@example">', {
			inlineImages: { 'abc123@example': { mimeType: 'image/png', data: bytes } }
		});
		expect(out).toContain('data:image/png;base64,');
	});

	it('drops <style>@import url(http://evil.example/...)>', () => {
		const out = sanitizeHtml(
			'<style>@import url(http://evil.example/x.css); p { color: red; }</style><p>x</p>',
			{ inlineImages: {} }
		);
		expect(out.toLowerCase()).not.toContain('@import');
		expect(out.toLowerCase()).not.toContain('evil.example');
	});

	it('strips utm_*/fbclid from <a href> when stripTracking is on', () => {
		const out = sanitizeHtml(
			'<a href="https://example.com/?utm_source=foo&keep=yes&fbclid=abc">go</a>',
			{ inlineImages: {}, stripTracking: true }
		);
		expect(out).not.toContain('utm_source');
		expect(out).not.toContain('fbclid');
		expect(out).toContain('keep=yes');
	});

	it('preserves tracking params when stripTracking is false', () => {
		const out = sanitizeHtml('<a href="https://example.com/?utm_source=foo">go</a>', {
			inlineImages: {},
			stripTracking: false
		});
		expect(out).toContain('utm_source');
	});

	it('adds target=_blank rel=noopener to anchors', () => {
		const out = sanitizeHtml('<a href="https://example.com/">go</a>', { inlineImages: {} });
		expect(out).toContain('target="_blank"');
		expect(out).toContain('rel="noopener noreferrer"');
	});
});
