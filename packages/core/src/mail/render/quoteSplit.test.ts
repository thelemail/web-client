import { describe, it, expect } from 'vitest';
import { splitQuotedHtml, splitQuotedText } from './quoteSplit';
import { forwardQuoteHtml, replyQuoteHtml, replyQuoteText, type QuoteSource } from '../quote';

const LONG = 'A long paragraph of earlier discussion that keeps going for a while. '.repeat(12);

function src(n: number, html?: string, text?: string): QuoteSource {
	return {
		fromDisplay: n % 2 ? 'Alice Example' : 'Bob Example',
		fromAddress: n % 2 ? 'alice@example.com' : 'bob@example.com',
		toLine: 'someone@example.com',
		epoch: Date.UTC(2026, 8, n + 1, 9, 30),
		subject: 'Re: Plans',
		html,
		text
	};
}

function mainText(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('splitQuotedHtml', () => {
	it('folds a gmail quote under a one-line reply', () => {
		const html = `<div dir="ltr">Thanks!</div><br>${replyQuoteHtml(src(1, `<p>${LONG}</p>`))}`;
		const res = splitQuotedHtml(html);
		expect(res.kind).toBe('quoted');
		expect(mainText(res.mainHtml)).toBe('Thanks!');
		expect(res.quotedHtml).toContain(LONG.trim());
	});

	it('folds every level of a growing thread', () => {
		let html = `<p>${LONG}</p>`;
		for (let n = 1; n <= 6; n++) {
			html = `<p>Reply number ${n}.</p>${replyQuoteHtml(src(n, html))}`;
			const res = splitQuotedHtml(html);
			expect(res.kind).toBe('quoted');
			expect(mainText(res.mainHtml)).toBe(`Reply number ${n}.`);
		}
	});

	it('folds when a forward sits inside the quoted history', () => {
		const fwd = `<p>fyi</p>${forwardQuoteHtml(src(1, `<p>${LONG}</p>`))}`;
		const html = `<p>Got it.</p>${replyQuoteHtml(src(2, fwd))}`;
		const res = splitQuotedHtml(html);
		expect(res.kind).toBe('quoted');
		expect(mainText(res.mainHtml)).toBe('Got it.');
	});

	it('reports a forward in the main part as forwarded', () => {
		const html = `<p>fyi</p>${forwardQuoteHtml(src(1, `<p>${LONG}</p>`))}`;
		expect(splitQuotedHtml(html).kind).toBe('forwarded');
	});

	it('finds the quote inside a wrapper with many children', () => {
		const html =
			'<div class="wrap"><p>First line.</p><p>Second line.</p><p>Third line.</p>' +
			`${replyQuoteHtml(src(1, `<p>${LONG}</p>`))}</div>`;
		const res = splitQuotedHtml(html);
		expect(res.kind).toBe('quoted');
		expect(mainText(res.mainHtml)).toBe('First line.Second line.Third line.');
	});

	it('folds an outlook reply block', () => {
		const html =
			'<div class="WordSection1"><p>Sounds good.</p></div>' +
			'<hr><div id="divRplyFwdMsg"><b>From:</b> Alice &lt;alice@example.com&gt;<br>' +
			'<b>Sent:</b> Monday, September 1, 2026 9:30 AM<br><b>Subject:</b> Plans</div>' +
			`<div><p>${LONG}</p></div>`;
		const res = splitQuotedHtml(html);
		expect(res.kind).toBe('quoted');
		expect(mainText(res.mainHtml)).toBe('Sounds good.');
		expect(res.quotedHtml).toContain('divRplyFwdMsg');
		expect(res.quotedHtml).toContain(LONG.trim());
	});

	it('folds an outlook appendonsend reply', () => {
		const html =
			'<div>Sounds good.</div><div id="appendonsend"></div><hr>' +
			'<div><b>From:</b> Alice<br><b>Sent:</b> Monday<br><b>To:</b> Bob</div>' +
			`<div><p>${LONG}</p></div>`;
		const res = splitQuotedHtml(html);
		expect(res.kind).toBe('quoted');
		expect(mainText(res.mainHtml)).toBe('Sounds good.');
		expect(res.quotedHtml).toContain(LONG.trim());
	});

	it('leaves an unattributed blockquote in the middle alone', () => {
		const html = '<p>He said</p><blockquote>something wise</blockquote><p>and I agree.</p>';
		expect(splitQuotedHtml(html).kind).toBe('none');
	});

	it('leaves a trailing unattributed blockquote alone', () => {
		const html = '<p>A poem I like:</p><blockquote>roses are red</blockquote>';
		expect(splitQuotedHtml(html).kind).toBe('none');
	});

	it('shows a message that is only a quote unfolded', () => {
		const html = replyQuoteHtml(src(1, `<p>${LONG}</p>`));
		expect(splitQuotedHtml(html).kind).toBe('none');
	});

	it('keeps an image-only reply folded above the quote', () => {
		const html = `<p><img src="cid:a@b"></p>${replyQuoteHtml(src(1, `<p>${LONG}</p>`))}`;
		const res = splitQuotedHtml(html);
		expect(res.kind).toBe('quoted');
		expect(res.mainHtml).toContain('cid:a@b');
	});

	it('matches an attribution wrapped across lines', () => {
		const html =
			'<p>Yes.</p><div>On Mon, Sep 1, 2026 at 9:30 AM Alice Example\n&lt;alice@example.com&gt; wrote:</div>' +
			`<blockquote><p>${LONG}</p></blockquote>`;
		const res = splitQuotedHtml(html);
		expect(res.kind).toBe('quoted');
		expect(mainText(res.mainHtml)).toBe('Yes.');
		expect(res.quotedHtml).toContain('wrote:');
	});

	it('matches portuguese and russian attributions', () => {
		for (const attr of [
			'Em seg., 1 de set. de 2026 às 09:30, Alice escreveu:',
			'1 сент. 2026 г., в 9:30, Alice &lt;alice@example.com&gt; пишет:'
		]) {
			const html = `<p>Ok.</p><div>${attr}</div><blockquote><p>${LONG}</p></blockquote>`;
			expect(splitQuotedHtml(html).kind).toBe('quoted');
		}
	});

	it('ignores text-free trailing wrappers after the quote', () => {
		const html = `<p>Ok.</p>${replyQuoteHtml(src(1, `<p>${LONG}</p>`))}<div><br></div>`;
		expect(splitQuotedHtml(html).kind).toBe('quoted');
	});

	it('carries document styles into the quoted html', () => {
		const html = `<style>.x{color:red}</style><p>Ok.</p>${replyQuoteHtml(src(1, `<p class="x">${LONG}</p>`))}`;
		const res = splitQuotedHtml(html);
		expect(res.kind).toBe('quoted');
		expect(res.quotedHtml).toContain('.x{color:red}');
		expect(res.mainHtml).toContain('.x{color:red}');
	});
});

describe('splitQuotedText', () => {
	it('folds a quote under a one-line reply', () => {
		const text = `Thanks!\n\n${replyQuoteText(src(1, undefined, LONG))}`;
		const res = splitQuotedText(text);
		expect(res.kind).toBe('quoted');
		expect(res.mainHtml).toBe('Thanks!');
	});

	it('folds every level of a growing thread', () => {
		let text = LONG;
		for (let n = 1; n <= 6; n++) {
			text = `Reply number ${n}.\n\n${replyQuoteText(src(n, undefined, text))}`;
			const res = splitQuotedText(text);
			expect(res.kind).toBe('quoted');
			expect(res.mainHtml).toBe(`Reply number ${n}.`);
		}
	});

	it('folds a single quoted line', () => {
		const text = 'Sure.\n\nOn Mon, Sep 1, 2026, Alice <alice@example.com> wrote:\n> see you then';
		const res = splitQuotedText(text);
		expect(res.kind).toBe('quoted');
		expect(res.mainHtml).toBe('Sure.');
	});

	it('only folds the trailing run of interleaved replies', () => {
		const text = [
			'On Mon, Sep 1, 2026, Alice <alice@example.com> wrote:',
			'> first question',
			'> still first',
			'',
			'Answer one.',
			'',
			'> second question',
			'> still second',
			'',
			'Answer two.'
		].join('\n');
		expect(splitQuotedText(text).kind).toBe('none');
	});

	it('folds a quote followed by a signature', () => {
		const text = [
			'Sure.',
			'',
			'On Mon, Sep 1, 2026, Alice <alice@example.com> wrote:',
			'> one',
			'> two',
			'',
			'-- ',
			'Bob'
		].join('\n');
		const res = splitQuotedText(text);
		expect(res.kind).toBe('quoted');
		expect(res.mainHtml).toBe('Sure.');
		expect(res.quotedHtml).toContain('> two');
		expect(res.quotedHtml).toContain('Bob');
	});

	it('folds an outlook original message block', () => {
		const text = [
			'Sounds good.',
			'',
			'-----Original Message-----',
			'From: Alice <alice@example.com>',
			'Sent: Monday, September 1, 2026 9:30 AM',
			'Subject: Plans',
			'',
			LONG
		].join('\n');
		const res = splitQuotedText(text);
		expect(res.kind).toBe('quoted');
		expect(res.mainHtml).toBe('Sounds good.');
		expect(res.quotedHtml).toContain('-----Original Message-----');
	});

	it('folds an outlook header block without a separator line', () => {
		const text = [
			'Sounds good.',
			'',
			'From: Alice <alice@example.com>',
			'Sent: Monday, September 1, 2026 9:30 AM',
			'To: Bob <bob@example.com>',
			'Subject: Plans',
			'',
			LONG
		].join('\n');
		const res = splitQuotedText(text);
		expect(res.kind).toBe('quoted');
		expect(res.mainHtml).toBe('Sounds good.');
	});

	it('folds when a forward sits inside the quoted history', () => {
		const inner = `fyi\n\n---------- Forwarded message ---------\nFrom: Alice\n\n${LONG}`;
		const text = `Got it.\n\n${replyQuoteText(src(2, undefined, inner))}`;
		const res = splitQuotedText(text);
		expect(res.kind).toBe('quoted');
		expect(res.mainHtml).toBe('Got it.');
	});

	it('reports a forward in the main part as forwarded', () => {
		const text = `fyi\n\n---------- Forwarded message ---------\nFrom: Alice\n\n${LONG}`;
		expect(splitQuotedText(text).kind).toBe('forwarded');
	});

	it('shows a message that is only a quote unfolded', () => {
		expect(splitQuotedText(replyQuoteText(src(1, undefined, LONG))).kind).toBe('none');
	});

	it('needs an attribution above a quoted run', () => {
		expect(splitQuotedText('Look at this:\n> a\n> b').kind).toBe('none');
	});
});
