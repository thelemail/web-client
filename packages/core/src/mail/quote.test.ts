import { describe, it, expect } from 'vitest';
import {
	forwardQuoteHtml,
	forwardQuoteText,
	replyAttribution,
	replyQuoteHtml,
	replyQuoteText,
	snippetSource,
	type QuoteSource
} from './quote';
import { splitQuotedHtml, splitQuotedText } from './render/quoteSplit';

function src(overrides: Partial<QuoteSource> = {}): QuoteSource {
	return {
		fromDisplay: 'Alice Example',
		fromAddress: 'alice@example.com',
		toLine: 'bob@example.com',
		epoch: Date.UTC(2026, 5, 3, 14, 5),
		subject: 'Re: Summer plans',
		html: '<p>Original message body.</p>',
		text: 'First original line.\nSecond original line.\nThird original line.',
		...overrides
	};
}

describe('replyAttribution', () => {
	it('produces an On … wrote: line with the sender', () => {
		const line = replyAttribution(src());
		expect(line.startsWith('On ')).toBe(true);
		expect(line.endsWith(' wrote:')).toBe(true);
		expect(line).toContain('Alice Example <alice@example.com>');
	});

	it('omits the angle brackets when the address is missing', () => {
		const line = replyAttribution(src({ fromAddress: '' }));
		expect(line).toContain('Alice Example wrote:');
		expect(line).not.toContain('<>');
	});
});

describe('replyQuoteHtml', () => {
	it('round-trips through splitQuotedHtml as quoted', () => {
		const main = `<p>${'A considered reply with plenty of text in it. '.repeat(8)}</p>`;
		const res = splitQuotedHtml(main + replyQuoteHtml(src()));
		expect(res.kind).toBe('quoted');
		expect(res.quotedHtml).toContain('Original message body.');
		expect(res.mainHtml).not.toContain('gmail_quote');
	});

	it('escapes the attribution and keeps the original html verbatim', () => {
		const html = replyQuoteHtml(src({ fromDisplay: 'Eve & "Mallory"' }));
		expect(html).toContain('Eve &amp; &quot;Mallory&quot; &lt;alice@example.com&gt;');
		expect(html).toContain('<p>Original message body.</p>');
		expect(html).toContain('<blockquote class="gmail_quote"');
	});

	it('falls back to escaped text when no html is available', () => {
		const html = replyQuoteHtml(src({ html: undefined, text: 'a < b\nnext line' }));
		expect(html).toContain('a &lt; b<br>next line');
	});
});

describe('replyQuoteText', () => {
	it('round-trips through splitQuotedText as quoted', () => {
		const main = 'Thanks, that works for me. '.repeat(8).trim();
		const res = splitQuotedText(`${main}\n\n${replyQuoteText(src())}`);
		expect(res.kind).toBe('quoted');
		expect(res.quotedHtml).toContain('> First original line.');
	});

	it('prefixes every original line', () => {
		const text = replyQuoteText(src());
		const lines = text.split('\n');
		expect(lines[0].endsWith(' wrote:')).toBe(true);
		expect(lines.slice(1)).toEqual([
			'> First original line.',
			'> Second original line.',
			'> Third original line.'
		]);
	});
});

describe('forwardQuoteText', () => {
	it('trips the forwarded-message detector', () => {
		const res = splitQuotedText(forwardQuoteText(src()));
		expect(res.kind).toBe('forwarded');
	});

	it('is still detected below a fresh note', () => {
		const res = splitQuotedText(`A quick note.\n\n${forwardQuoteText(src())}`);
		expect(res.kind).toBe('forwarded');
	});

	it('lists the headers with a stripped subject and no Cc when empty', () => {
		const text = forwardQuoteText(src());
		expect(text).toContain('---------- Forwarded message ---------');
		expect(text).toContain('From: Alice Example <alice@example.com>');
		expect(text).toContain('Subject: Summer plans');
		expect(text).toContain('To: bob@example.com');
		expect(text).not.toContain('Cc:');
		expect(text.endsWith('\nThird original line.')).toBe(true);
	});

	it('includes the Cc line when present', () => {
		const text = forwardQuoteText(src({ ccLine: 'carol@example.com' }));
		expect(text).toContain('Cc: carol@example.com');
	});
});

describe('snippetSource', () => {
	it('returns a plain body untouched', () => {
		expect(snippetSource('  Just a note.  ')).toBe('Just a note.');
	});

	it('keeps the reply attribution for a reply body', () => {
		const body = `Sounds good.\n\n${replyQuoteText(src())}`;
		expect(snippetSource(body).startsWith('Sounds good.')).toBe(true);
	});

	it('prefers the note written above a forwarded message', () => {
		const body = `Have a look at this.\n\n${forwardQuoteText(src())}`;
		expect(snippetSource(body)).toBe('Have a look at this.');
	});

	it('falls back to the forwarded body when no note was added', () => {
		expect(snippetSource(forwardQuoteText(src()))).toBe(
			'First original line.\nSecond original line.\nThird original line.'
		);
	});

	it('drops the Cc header line too', () => {
		const body = forwardQuoteText(src({ ccLine: 'carol@example.com' }));
		expect(snippetSource(body).startsWith('First original line.')).toBe(true);
		expect(snippetSource(body)).not.toContain('carol@example.com');
	});

	it('is empty when the forwarded message had no body', () => {
		expect(snippetSource(forwardQuoteText(src({ text: '' })))).toBe('');
	});

	it('keeps forwarded body lines that look like headers', () => {
		const body = forwardQuoteText(src({ text: 'To: whom it may concern\nRegards' }));
		expect(snippetSource(body)).toBe('To: whom it may concern\nRegards');
	});
});

describe('forwardQuoteHtml', () => {
	it('is detected as forwarded by splitQuotedHtml', () => {
		const res = splitQuotedHtml(forwardQuoteHtml(src()));
		expect(res.kind).toBe('forwarded');
	});

	it('wraps the escaped headers and original html in a gmail_quote', () => {
		const html = forwardQuoteHtml(src({ fromDisplay: 'Eve & Co' }));
		expect(html.startsWith('<div class="gmail_quote">')).toBe(true);
		expect(html).toContain('From: Eve &amp; Co &lt;alice@example.com&gt;');
		expect(html).toContain('<p>Original message body.</p>');
	});
});
