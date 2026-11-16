import { describe, expect, it } from 'vitest';
import { Field, Role } from '../sqlite/types';
import { LIMITS, Warning, extractDraft, extractMime } from './extract';
import { htmlToText } from './html';
import { regions } from './regions';

const enc = (s: string) => new TextEncoder().encode(s.replace(/\n/g, '\r\n'));

function fieldTexts(parts: { field: Field; text: string }[], field: Field): string[] {
	return parts.filter((p) => p.field === field).map((p) => p.text);
}

describe('htmlToText', () => {
	it('drops scripts, styles, head and hidden elements and keeps link targets', () => {
		const html = `<html><head><title>T</title><style>.x{color:red}</style></head><body>
			<script>track()</script><p>Quarterly&nbsp;report &amp; notes</p>
			<div style="display:none">hidden preheader</div><span hidden>also hidden</span>
			<a href="https://calloway.test/r/1">Read online</a> <a href="mailto:ada@calloway.test">ada@calloway.test</a>
			<img src="https://tracker.test/p.gif" width="1" height="1"><img src="cid:logo" alt="Calloway logo">
			<table><tr><td>Cell A</td><td>Cell B</td></tr></table></body></html>`;
		const text = htmlToText(html);
		expect(text).toContain('Quarterly report & notes'.replace(' ', ' '));
		expect(text).toContain('Read online https://calloway.test/r/1');
		expect(text).toContain('Calloway logo');
		expect(text).toContain('Cell A Cell B');
		for (const absent of ['track()', 'color:red', 'hidden preheader', 'also hidden', 'tracker.test', 'mailto:']) expect(text).not.toContain(absent);
	});

	it('decodes numeric entities and survives broken markup', () => {
		expect(htmlToText('caf&#233; &#x1F600; &bogus; <b>bold<i> unclosed')).toBe('café 😀 &bogus; bold unclosed');
		expect(htmlToText('a < b and <script>never closed')).toBe('a < b and');
	});
});

describe('regions', () => {
	it('separates body, attribution plus quoted lines and signature', () => {
		const text = 'Sounds good, see you Monday.\n\nOn Tue, 3 Nov 2026, Bram wrote:\n> Lunch at the harbour?\n> Bram\n\n-- \nAda Calloway\nCalloway Ltd';
		expect(regions(text)).toEqual([
			{ field: Field.body, text: 'Sounds good, see you Monday.' },
			{ field: Field.quoted, text: 'On Tue, 3 Nov 2026, Bram wrote:\n> Lunch at the harbour?\n> Bram' },
			{ field: Field.signature, text: '-- \nAda Calloway\nCalloway Ltd' }
		]);
	});

	it('treats everything after an original-message marker as quoted', () => {
		expect(regions('Thanks!\n-----Original Message-----\nFrom: Bram\nOld text')).toEqual([
			{ field: Field.body, text: 'Thanks!' },
			{ field: Field.quoted, text: '-----Original Message-----\nFrom: Bram\nOld text' }
		]);
	});
});

describe('extractMime', () => {
	const alternative = `From: Ada Calloway <ada@calloway.test>
To: Bram Calloway <bram@calloway.test>, Team: cora@calloway.test, dov@calloway.test;
Cc: eli@calloway.test
Subject: =?UTF-8?Q?Harbour_ledger_=E2=80=93_Q3?=
Message-ID: <ledger-1@calloway.test>
List-ID: Calloway news <news.calloway.test>
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="b1"

--b1
Content-Type: text/plain; charset=utf-8

The ledger is attached.
--b1
Content-Type: text/html; charset=utf-8

<p>The ledger is attached.</p><p style="display:none">secret preheader</p><p>Only in html: lighthouse</p><img src="https://pixel.test/o.gif">
--b1--
`;

	it('keeps typed participants, identifiers and html-only text as its own part', async () => {
		const out = await extractMime(enc(alternative));
		expect(out.outcome).toBe('complete');
		expect(out.subject).toBe('Harbour ledger – Q3');
		expect(out.messageId).toBe('<ledger-1@calloway.test>');
		expect(out.listId).toBe('Calloway news <news.calloway.test>');
		expect(out.participants).toEqual([
			{ role: Role.from, name: 'Ada Calloway', address: 'ada@calloway.test' },
			{ role: Role.to, name: 'Bram Calloway', address: 'bram@calloway.test' },
			{ role: Role.to, name: '', address: 'cora@calloway.test' },
			{ role: Role.to, name: '', address: 'dov@calloway.test' },
			{ role: Role.cc, name: '', address: 'eli@calloway.test' }
		]);
		expect(out.parts).toEqual([
			{ field: Field.body, text: 'The ledger is attached.', locator: 0 },
			{ field: Field.body, text: 'The ledger is attached.\n\nOnly in html: lighthouse', locator: 1 }
		]);
		expect(JSON.stringify(out)).not.toContain('secret preheader');
		expect(JSON.stringify(out)).not.toContain('pixel.test');
	});

	it('does not repeat an html alternative that adds nothing', async () => {
		const out = await extractMime(enc(alternative.replace('<p>Only in html: lighthouse</p>', '')));
		expect(fieldTexts(out.parts, Field.body)).toEqual(['The ledger is attached.']);
	});

	it('flags an undecodable charset instead of failing', async () => {
		const raw = `From: a@calloway.test\nSubject: x\nContent-Type: text/plain; charset=x-calloway-7\n\nplain words\n`;
		const out = await extractMime(enc(raw));
		expect(out.outcome).toBe('complete');
		expect(out.warnings & Warning.charset).toBeTruthy();
		expect(fieldTexts(out.parts, Field.body)).toEqual(['plain words']);
	});

	it('extracts nested messages as separate parts and lists attachments', async () => {
		const raw = `From: ada@calloway.test
Subject: Fwd: minutes
Content-Type: multipart/mixed; boundary="m1"

--m1
Content-Type: text/plain

See below.
--m1
Content-Type: message/rfc822
Content-Disposition: attachment; filename="minutes.eml"

From: Bram <bram@calloway.test>
Subject: Board minutes
Content-Type: text/plain

The board approved the lighthouse budget.
--m1
Content-Type: application/pdf; name="budget.pdf"
Content-Disposition: attachment; filename="budget.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQK
--m1--
`;
		const out = await extractMime(enc(raw));
		expect(out.outcome).toBe('complete');
		expect(out.parts.map((p) => [p.locator, p.text])).toEqual([
			[0, 'See below.'],
			[1, 'Board minutes'],
			[1, 'Bram <bram@calloway.test>'],
			[1, 'The board approved the lighthouse budget.']
		]);
		expect(out.attachments).toEqual([
			{ attachmentId: 'mime:0', filename: 'minutes.eml', mime: 'message/rfc822', size: expect.any(Number), inline: false },
			{ attachmentId: 'mime:1', filename: 'budget.pdf', mime: 'application/pdf', size: 9, inline: false }
		]);
	});

	it('stops at the text budget and reports a resource limit', async () => {
		const raw = `From: a@calloway.test\nSubject: long\nContent-Type: text/plain\n\n${'harbour '.repeat(200)}\n`;
		const out = await extractMime(enc(raw), { ...LIMITS, maxText: 100 });
		expect(out.outcome).toBe('resource_limited');
		expect(out.warnings & Warning.truncated).toBeTruthy();
		expect(out.parts.reduce((n, p) => n + p.text.length, 0)).toBe(100);
	});
});

describe('extractDraft', () => {
	it('reads typed recipients, subject, text and attachment metadata', () => {
		const doc = {
			v: 2,
			from: { email: 'ada@calloway.test', name: 'Ada' },
			to: [{ address: 'bram@calloway.test', name: 'Bram' }],
			cc: [],
			bcc: [{ address: 'cora@calloway.test' }],
			subject: 'Budget draft',
			bodyText: 'Numbers attached.\n\n> earlier note',
			bodyHtml: '<p>Numbers attached.</p><blockquote>&gt; earlier note</blockquote>',
			attachments: [{ filename: 'budget.xlsx', mime: 'application/vnd.ms-excel', size: 4096, disposition: 'attachment', offset: 0, length: 5000 }]
		};
		const out = extractDraft(new TextEncoder().encode(JSON.stringify(doc)));
		expect(out.outcome).toBe('complete');
		expect(out.subject).toBe('Budget draft');
		expect(out.participants).toEqual([
			{ role: Role.from, name: 'Ada', address: 'ada@calloway.test' },
			{ role: Role.to, name: 'Bram', address: 'bram@calloway.test' },
			{ role: Role.bcc, name: '', address: 'cora@calloway.test' }
		]);
		expect(out.parts).toEqual([
			{ field: Field.body, text: 'Numbers attached.', locator: 0 },
			{ field: Field.quoted, text: '> earlier note', locator: 0 }
		]);
		expect(out.attachments).toEqual([{ attachmentId: 'draft:0', filename: 'budget.xlsx', mime: 'application/vnd.ms-excel', size: 4096, inline: false }]);
	});

	it('reports a corrupt draft as malformed, never as an empty body', () => {
		expect(extractDraft(new TextEncoder().encode('{not json')).outcome).toBe('malformed');
	});
});
