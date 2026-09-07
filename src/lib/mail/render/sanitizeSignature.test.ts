import { describe, it, expect } from 'vitest';
import { sanitizeSignatureHtml } from './sanitizeSignature';

const IMG = 'data-thelemail-sig-image';

describe('sanitizeSignatureHtml', () => {
	it('strips scripts and event handlers', () => {
		const out = sanitizeSignatureHtml('<p onclick="steal()">hi</p><script>steal()</script>');
		expect(out).not.toContain('script');
		expect(out).not.toContain('onclick');
		expect(out).toContain('hi');
	});

	it('drops javascript: links but keeps ordinary ones', () => {
		const out = sanitizeSignatureHtml(
			'<a href="javascript:steal()">bad</a><a href="https://example.com">good</a>'
		);
		expect(out).not.toContain('javascript:');
		expect(out).toContain('https://example.com');
	});

	it('keeps mailto and tel links', () => {
		const out = sanitizeSignatureHtml('<a href="mailto:a@b.com">m</a><a href="tel:+123">t</a>');
		expect(out).toContain('mailto:a@b.com');
		expect(out).toContain('tel:+123');
	});

	it('does not rewrite links the way the inbound viewer profile does', () => {
		const out = sanitizeSignatureHtml('<a href="https://example.com?utm_source=x">go</a>');
		expect(out).not.toContain('target="_blank"');
		expect(out).toContain('utm_source=x');
	});

	it('keeps our own signature images and blanks their src', () => {
		const out = sanitizeSignatureHtml(`<img ${IMG}="k1" src="https://cdn.example/x.png">`);
		expect(out).toContain(IMG);
		expect(out).toContain('src=""');
	});

	it('drops a bare remote image by default', () => {
		const out = sanitizeSignatureHtml('<p>hi</p><img src="https://tracker.example/p.gif">');
		expect(out).not.toContain('<img');
		expect(out).toContain('hi');
	});

	it('keeps a remote image while pasting so it can be hosted afterwards', () => {
		const out = sanitizeSignatureHtml('<img src="https://cdn.example/logo.png">', {
			keepRemoteImages: true
		});
		expect(out).toContain('cdn.example/logo.png');
	});

	it('keeps inline styles but scrubs remote css payloads', () => {
		const out = sanitizeSignatureHtml(
			'<p style="color:red;background:url(https://evil.example/x.png)">hi</p>'
		);
		expect(out).toContain('color');
		expect(out).not.toContain('evil.example');
	});

	it('keeps table layout, which real signatures rely on', () => {
		const out = sanitizeSignatureHtml('<table><tr><td>Ada</td></tr></table>');
		expect(out).toContain('<table');
		expect(out).toContain('<td');
	});

	it('drops iframes, forms and style blocks', () => {
		const out = sanitizeSignatureHtml(
			'<iframe src="https://x"></iframe><form></form><style>p{}</style><p>ok</p>'
		);
		expect(out).not.toContain('iframe');
		expect(out).not.toContain('<form');
		expect(out).not.toContain('<style');
		expect(out).toContain('ok');
	});
});
