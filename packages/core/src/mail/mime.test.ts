import { describe, it, expect } from 'vitest';
import {
	BASE64_WINDOW,
	buildMIME,
	composeMime,
	composeMimeBytes,
	quotedPrintable,
	type BuildMIMEArgs,
	type IssuedHeaders
} from './mime';

const baseArgs: BuildMIMEArgs = {
	fromName: 'Ada',
	fromAddress: 'ada@thelemail.com',
	to: [{ display: 'Bob', address: 'bob@example.org' }],
	subject: 'Report',
	body: 'See attached.',
	date: new Date('2026-09-23T10:00:00Z'),
	messageId: 'm-1',
	messageIdDomain: 'thelemail.com'
};

const issued: IssuedHeaders = {
	date: 'Wed, 23 Sep 2026 10:00:00 +0000',
	messageId: '<issued@thelemail.com>',
	fromName: 'Ada',
	fromAddress: 'ada@thelemail.com'
};

function pattern(size: number): Uint8Array {
	const out = new Uint8Array(size);
	for (let i = 0; i < size; i++) out[i] = (i * 7 + 13) % 256;
	return out;
}

class GuardedFile extends File {
	arrayBuffer(): Promise<ArrayBuffer> {
		throw new Error('the whole file was read into memory');
	}
}

function attachmentBase64(mime: string, filename: string): string {
	const at = mime.indexOf(`filename="${filename}"`);
	const body = mime.slice(mime.indexOf('\r\n\r\n', at) + 4);
	return body.slice(0, body.indexOf('\r\n--')).replace(/\r\n/g, '');
}

function decodeQuotedPrintable(qp: string): string {
	const soft = qp.replace(/=\r\n/g, '');
	const bytes: number[] = [];
	for (let i = 0; i < soft.length; i++) {
		if (soft[i] === '=') {
			bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
			i += 2;
			continue;
		}
		bytes.push(soft.charCodeAt(i));
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}

describe('composeMime', () => {
	const sizes = [0, 1, 2, 3, 56, 57, 58, 57 * 1024 - 1, BASE64_WINDOW - 1, BASE64_WINDOW, BASE64_WINDOW + 1, 2 * BASE64_WINDOW + 5];
	for (const size of sizes) {
		it(`encodes a ${size} byte file in windows exactly as a single pass would`, async () => {
			const data = pattern(size);
			const file = new GuardedFile([data], 'data.bin', { type: 'application/octet-stream' });
			const blob = await composeMime(
				{ ...baseArgs, attachments: [{ filename: 'data.bin', contentType: file.type, source: file }] },
				issued
			);
			const mime = await blob.text();
			if (size === 0) {
				expect(mime).not.toContain('data.bin');
				return;
			}
			expect(attachmentBase64(mime, 'data.bin')).toBe(Buffer.from(data).toString('base64'));
			const at = mime.indexOf('filename="data.bin"');
			const encoded = mime.slice(mime.indexOf('\r\n\r\n', at) + 4);
			for (const line of encoded.slice(0, encoded.indexOf('\r\n--')).split('\r\n')) {
				expect(line.length).toBeLessThanOrEqual(76);
			}
			for (const line of mime.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
		});
	}

	it('produces 7-bit CRLF-only output for non-ASCII content', async () => {
		const blob = await composeMime(
			{
				...baseArgs,
				subject: 'Счёт за май',
				body: 'Привет,\nвот счёт.\r\nСпасибо',
				bodyHtml: '<p>Привет</p>',
				calendar: { method: 'REQUEST', ics: 'BEGIN:VCALENDAR\nEND:VCALENDAR' }
			},
			issued
		);
		const bytes = new Uint8Array(await blob.arrayBuffer());
		expect(bytes.every((b) => b > 0 && b < 0x80)).toBe(true);
		const text = new TextDecoder().decode(bytes);
		expect(text).not.toMatch(/(^|[^\r])\n/);
		expect(text).not.toMatch(/\r(?!\n)/);
	});

	it('writes the issued headers verbatim and never a Bcc', async () => {
		const blob = await composeMime(
			{ ...baseArgs, bcc: [{ display: 'Blind', address: 'blind@example.org' }] },
			{
				...issued,
				fromName: 'Ada "the admin" Lovelace',
				inReplyTo: '<p@example.org>',
				references: ['<r@example.org>', '<p@example.org>'],
				replyTo: 'replies@thelemail.com'
			}
		);
		const mime = await blob.text();
		const header = mime.slice(0, mime.indexOf('\r\n\r\n'));
		expect(header).toContain('Date: Wed, 23 Sep 2026 10:00:00 +0000');
		expect(header).toContain('Message-ID: <issued@thelemail.com>');
		expect(header).toContain('In-Reply-To: <p@example.org>');
		expect(header).toContain('References: <r@example.org> <p@example.org>');
		expect(header).toContain('Reply-To: replies@thelemail.com');
		expect(header).not.toMatch(/^Bcc:/im);
		expect(mime).not.toContain('blind@example.org');
		const from = /^From: (.*)$/m.exec(header)![1];
		expect(from).toMatch(/^=\?utf-8\?B\?.+\?= <ada@thelemail\.com>$/);
		const decoded = from
			.slice(0, from.lastIndexOf(' <'))
			.split(' ')
			.map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8'))
			.join('');
		expect(decoded).toBe('Ada "the admin" Lovelace');
		expect(blob.type).toBe('message/rfc822');
	});

	it('matches the byte form used for encrypted copies', async () => {
		const file = new File([pattern(3000)], 'a.bin');
		const args = { ...baseArgs, attachments: [{ filename: 'a.bin', contentType: '', source: file }] };
		const bytes = await composeMimeBytes(args);
		const text = new TextDecoder().decode(bytes);
		expect(attachmentBase64(text, 'a.bin')).toBe(Buffer.from(pattern(3000)).toString('base64'));
	});

	it('keeps buildMIME and composeMime in step for in-memory sources', async () => {
		const args = { ...baseArgs, attachments: [{ filename: 'x.txt', contentType: 'text/plain', source: pattern(500) }] };
		const sync = new TextDecoder().decode(buildMIME(args));
		const streamed = new TextDecoder().decode(await composeMimeBytes(args));
		const strip = (s: string) => s.replace(/=_tm_[a-z]+_[0-9a-f]+/g, 'B');
		expect(strip(streamed)).toBe(strip(sync));
	});
});

describe('quotedPrintable', () => {
	const samples = [
		'plain ascii',
		'ends with space ',
		'ends with tab\t',
		'equals = sign and --=_tm_boundary',
		'Привет, мир. Ünïcödé',
		'x'.repeat(300),
		'line one\r\nline two \r\n\r\nline four',
		'.leading dot\r\n.',
		'='.repeat(100)
	];
	for (const sample of samples) {
		it(`round-trips ${JSON.stringify(sample.slice(0, 24))}`, () => {
			const encoded = quotedPrintable(sample);
			for (const line of encoded.split('\r\n')) {
				expect(line.length).toBeLessThanOrEqual(76);
				expect(line).not.toMatch(/[ \t]$/);
				expect(/^[\x21-\x7e \t]*$/.test(line)).toBe(true);
			}
			expect(encoded).not.toContain('=_');
			expect(decodeQuotedPrintable(encoded)).toBe(sample);
		});
	}
});
