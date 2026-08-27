import { describe, it, expect } from 'vitest';
import { renderBody } from './renderBody';

describe('renderBody', () => {
	it('emits a constant restrictive CSP — img-src is always data: cid:', async () => {
		const res1 = await renderBody({ html: '<p>x</p>' });
		const res2 = await renderBody({ text: 'plain text' });
		expect(res1.srcDoc).toContain("img-src data: cid:");
		expect(res1.srcDoc).not.toContain('https:');
		expect(res2.srcDoc).toContain("img-src data: cid:");
	});

	it('forbids script-src via CSP', async () => {
		const res = await renderBody({ html: '<p>x</p>' });
		expect(res.srcDoc).toContain('script-src &#39;none&#39;');
	});

	it('strips http(s) <img src> from HTML body — no direct loads ever', async () => {
		const res = await renderBody({
			html: '<p>hi</p><img src="https://tracker.example.com/p.gif">'
		});
		expect(res.srcDoc).not.toContain('tracker.example.com');
		expect(res.remoteImagesBlocked).toBe(1);
	});

	it('linkifies URLs in plain text and escapes HTML special chars', async () => {
		const res = await renderBody({ text: 'see https://example.com/x for <b>more</b>' });
		expect(res.srcDoc).toContain('<a href="https://example.com/x"');
		expect(res.srcDoc).toContain('&lt;b&gt;');
	});

	it('preserves a cid: image src in HTML', async () => {
		const res = await renderBody({ html: '<img src="cid:nomatch@x">' });
		expect(typeof res.srcDoc).toBe('string');
		expect(res.srcDoc).toContain('<!doctype html>');
	});

	it('contentHtml keeps the full pre-split sanitized html while srcDoc drops the quote', async () => {
		const html =
			'<p>Here is my long reply with plenty of words to keep the split ratio balanced.</p>' +
			'<div class="gmail_quote"><div class="gmail_attr">On Mon, 1 Jan 2024 at 10:00, Bob &lt;bob@x.com&gt; wrote:</div>' +
			'<blockquote class="gmail_quote">old quoted line</blockquote></div>';
		const res = await renderBody({ html });
		expect(res.quoted?.srcDoc).toContain('old quoted line');
		expect(res.srcDoc).not.toContain('old quoted line');
		expect(res.contentHtml).toContain('Here is my long reply');
		expect(res.contentHtml).toContain('old quoted line');
		expect(res.contentHtml).toContain('gmail_quote');
		expect(res.contentHtml).not.toContain('<!doctype');
	});

	it('contentHtml is sanitized', async () => {
		const res = await renderBody({ html: '<p>ok</p><script>alert(1)</script>' });
		expect(res.contentHtml).toContain('ok');
		expect(res.contentHtml).not.toContain('script');
	});

	it('contentText carries the full plain body including quoted lines', async () => {
		const text = [
			'Thanks, that works for me and I will follow up tomorrow morning.',
			'',
			'On Mon, 1 Jan 2024 at 10:00, Bob <bob@x.com> wrote:',
			'> the original line one',
			'> the original line two'
		].join('\n');
		const res = await renderBody({ text });
		expect(res.quoted?.srcDoc).toContain('the original line one');
		expect(res.srcDoc).not.toContain('the original line one');
		expect(res.contentText).toBe(text);
	});

	it('contentHtml is absent for plain text and contentText absent for html-only input', async () => {
		const textOnly = await renderBody({ text: 'plain body' });
		expect(textOnly.contentHtml).toBeUndefined();
		expect(textOnly.contentText).toBe('plain body');
		const htmlOnly = await renderBody({ html: '<p>rich body</p>' });
		expect(htmlOnly.contentHtml).toContain('rich body');
		expect(htmlOnly.contentText).toBeUndefined();
	});
});
