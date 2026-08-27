import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('openpgp', () => ({
	readKey: vi.fn()
}));
vi.mock('$lib/directory/verify', () => ({
	verifyDirectoryLookup: vi.fn(),
	DirectoryVerificationError: class extends Error {}
}));
vi.mock('$lib/directory/signing-key', () => ({
	DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: ''
}));
vi.mock('$lib/keystore/keystore-client', () => ({
	keystore: { subscribe: () => () => {} }
}));
vi.mock('$lib/stores/auth.svelte', () => ({
	auth: { accountId: null, email: null, fullName: null }
}));
vi.mock('./signaturePack', () => ({
	packBodyForSend: async (bodyHtml: string | undefined) => ({ bodyHtml, relatedParts: [] })
}));

import {
	buildMIME,
	buildPreview,
	messageIdDomain,
	sendErrorFromApi,
	SendError,
	type ComposeInput
} from './send';
import { ApiCallError } from '$lib/api/types';

function decode(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

function headerSection(bytes: Uint8Array): string {
	return decode(bytes).split('\r\n\r\n')[0];
}

const baseArgs = {
	fromName: 'Vlad',
	fromAddress: 'vlad@thelemail.com',
	subject: 'Hello',
	body: 'Body text',
	date: new Date('2026-08-07T10:00:00Z'),
	messageId: 'uuid-1',
	messageIdDomain: 'thelemail.com'
};

describe('buildMIME', () => {
	it('joins multiple To recipients with display-name pairs', () => {
		const h = headerSection(
			buildMIME({
				...baseArgs,
				to: [
					{ display: 'Ada Lovelace', address: 'ada@thelemail.com' },
					{ display: '', address: 'bob@thelemail.com' }
				]
			})
		);
		expect(h).toContain('To: "Ada Lovelace" <ada@thelemail.com>, bob@thelemail.com');
	});

	it('emits Cc, Bcc and Reply-To only when passed', () => {
		const plain = headerSection(
			buildMIME({ ...baseArgs, to: [{ display: '', address: 'ada@thelemail.com' }] })
		);
		expect(plain).not.toContain('Cc:');
		expect(plain).not.toContain('Bcc:');
		expect(plain).not.toContain('Reply-To:');

		const full = headerSection(
			buildMIME({
				...baseArgs,
				to: [{ display: '', address: 'ada@thelemail.com' }],
				cc: [{ display: 'Carol', address: 'carol@thelemail.com' }],
				bcc: [{ display: '', address: 'dave@thelemail.com' }],
				replyTo: { display: 'Vlad Alias', address: 'alias@thelemail.com' }
			})
		);
		expect(full).toContain('Cc: "Carol" <carol@thelemail.com>');
		expect(full).toContain('Bcc: dave@thelemail.com');
		expect(full).toContain('Reply-To: "Vlad Alias" <alias@thelemail.com>');
	});

	it('omits Bcc entirely when the list is empty', () => {
		const h = headerSection(
			buildMIME({ ...baseArgs, to: [{ display: '', address: 'ada@thelemail.com' }], bcc: [] })
		);
		expect(h).not.toContain('Bcc:');
	});

	it('strips quotes and line breaks from display names', () => {
		const h = headerSection(
			buildMIME({
				...baseArgs,
				to: [{ display: 'Evil"\r\nBcc: spy@x.com', address: 'ada@thelemail.com' }]
			})
		);
		expect(h).toContain('To: "EvilBcc: spy@x.com" <ada@thelemail.com>');
		expect(h.split('\r\n').filter((l) => l.startsWith('Bcc:'))).toEqual([]);
	});

	it('cannot be made to inject a header through the subject', () => {
		const bytes = buildMIME({
			...baseArgs,
			subject: 'Re: hi\r\nBcc: spy@x.com\r\nX-Evil: 1',
			to: [{ display: '', address: 'ada@thelemail.com' }]
		});
		const h = headerSection(bytes);
		const lines = h.split('\r\n');
		expect(lines.filter((l) => l.startsWith('Bcc:'))).toEqual([]);
		expect(lines.filter((l) => l.startsWith('X-Evil:'))).toEqual([]);
		expect(h).toContain('Subject: Re: hiBcc: spy@x.comX-Evil: 1');
		expect(decode(bytes).indexOf('\r\n\r\n')).toBe(h.length);
	});

	it('cannot be made to inject a header through a recipient address', () => {
		const h = headerSection(
			buildMIME({
				...baseArgs,
				to: [
					{ display: '', address: 'ada@thelemail.com>\r\nBcc: spy@x.com\r\nTo: <evil@x.com' },
					{ display: 'Ada', address: 'b@x.com\r\nX-Evil: 2' }
				]
			})
		);
		const lines = h.split('\r\n');
		expect(lines.filter((l) => l.startsWith('Bcc:'))).toEqual([]);
		expect(lines.filter((l) => l.startsWith('X-Evil:'))).toEqual([]);
		expect(lines.filter((l) => l.startsWith('To:'))).toHaveLength(1);
	});

	it('cannot be made to inject a header through the sender or thread ids', () => {
		const h = headerSection(
			buildMIME({
				...baseArgs,
				fromAddress: 'vlad@thelemail.com\r\nX-From-Evil: 1',
				messageIdDomain: 'thelemail.com\r\nX-Domain-Evil: 1',
				inReplyTo: 'parent@x.com>\r\nX-Reply-Evil: 1',
				references: ['a@x.com', 'b@x.com>\r\nX-Ref-Evil: 1'],
				to: [{ display: '', address: 'ada@thelemail.com' }]
			})
		);
		expect(h.split('\r\n').filter((l) => l.startsWith('X-'))).toEqual([]);
		expect(h.split('\r\n').filter((l) => l.startsWith('References:'))).toHaveLength(1);
	});

	it('cannot be made to inject a header through attachment metadata', () => {
		const h = decode(
			buildMIME({
				...baseArgs,
				to: [{ display: '', address: 'ada@thelemail.com' }],
				attachments: [
					{
						filename: 'ok.txt"\r\nX-Att-Evil: 1\r\n\r\npwned',
						contentType: 'text/plain\r\nX-Type-Evil: 1',
						bytes: new Uint8Array([1, 2, 3])
					}
				]
			})
		);
		expect(h.split('\r\n').filter((l) => l.startsWith('X-'))).toEqual([]);
		expect(h).not.toContain('\r\n\r\npwned');
	});

	it('mints the Message-ID under the given domain', () => {
		const h = headerSection(
			buildMIME({ ...baseArgs, to: [{ display: '', address: 'ada@thelemail.com' }] })
		);
		expect(h).toContain('Message-ID: <uuid-1@thelemail.com>');
	});
});

describe('header quoting and folding', () => {
	const to = [{ display: '', address: 'ada@thelemail.com' }];

	function headerLines(bytes: Uint8Array): string[] {
		return headerSection(bytes).split('\r\n');
	}

	function headerBlock(bytes: Uint8Array, name: string): string {
		const lines = headerLines(bytes);
		const start = lines.findIndex((l) => l.startsWith(`${name}:`));
		expect(start).toBeGreaterThanOrEqual(0);
		let end = start + 1;
		while (end < lines.length && /^[ \t]/.test(lines[end])) end++;
		return lines.slice(start, end).join('\r\n');
	}

	function unfold(block: string): string {
		return block.replace(/\r\n/g, '');
	}

	function decodeWords(value: string): string {
		return value
			.replace(/\?=\s+=\?/g, '?==?')
			.replace(/=\?utf-8\?B\?([^?]*)\?=/g, (_, b64: string) =>
				new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
			);
	}

	function mailboxes(list: string): number {
		let count = 1;
		let quoted = false;
		for (let i = 0; i < list.length; i++) {
			const c = list[i];
			if (quoted && c === '\\') {
				i++;
				continue;
			}
			if (c === '"') quoted = !quoted;
			else if (c === ',' && !quoted) count++;
		}
		expect(quoted).toBe(false);
		return count;
	}

	it('escapes backslashes so a display name cannot break out of the quoted string', () => {
		const block = headerBlock(
			buildMIME({
				...baseArgs,
				to: [
					{ display: 'Ada\\', address: 'ada@thelemail.com' },
					{ display: '', address: 'bob@thelemail.com' }
				]
			}),
			'To'
		);
		expect(block).toBe('To: "Ada\\\\" <ada@thelemail.com>, bob@thelemail.com');
		expect(mailboxes(block.slice('To: '.length))).toBe(2);
	});

	it('escapes backslashes in the sender display name', () => {
		const block = headerBlock(buildMIME({ ...baseArgs, fromName: 'Vlad\\', to }), 'From');
		expect(block).toBe('From: "Vlad\\\\" <vlad@thelemail.com>');
		expect(mailboxes(block.slice('From: '.length))).toBe(1);
	});

	it('escapes backslashes in attachment filename parameters', () => {
		const mime = decode(
			buildMIME({
				...baseArgs,
				to,
				attachments: [
					{ filename: 'evil\\', contentType: 'text/plain', bytes: new Uint8Array([1, 2, 3]) }
				]
			})
		);
		expect(mime).toContain('; name="evil\\\\"');
		expect(mime).toContain('Content-Disposition: attachment; filename="evil\\\\"');
	});

	it('strips the NEL separator from header text', () => {
		const bytes = buildMIME({ ...baseArgs, subject: 'Re: hi\u0085Bcc: spy@x.com', to });
		expect(headerSection(bytes)).not.toContain('\u0085');
		expect(headerBlock(bytes, 'Subject')).toBe('Subject: Re: hiBcc: spy@x.com');
	});

	it('encodes non-ascii subjects and display names as encoded words', () => {
		const bytes = buildMIME({
			...baseArgs,
			fromName: 'Vlád',
			subject: 'Über wichtig \u{1F525}',
			to: [{ display: 'Ann Müller', address: 'ann@thelemail.com' }]
		});
		const h = headerSection(bytes);
		expect(h).not.toContain('Über');
		expect(h).not.toContain('Müller');
		expect(headerBlock(bytes, 'Subject')).toContain('=?utf-8?B?');
		expect(decodeWords(unfold(headerBlock(bytes, 'Subject')))).toBe(
			'Subject: Über wichtig \u{1F525}'
		);
		expect(decodeWords(headerBlock(bytes, 'To'))).toBe('To: Ann Müller <ann@thelemail.com>');
		expect(decodeWords(headerBlock(bytes, 'From'))).toBe('From: Vlád <vlad@thelemail.com>');
	});

	it('folds a long subject and unfolds losslessly', () => {
		const subject = Array.from({ length: 40 }, (_, i) => `word-${i}`).join(' ');
		const block = headerBlock(buildMIME({ ...baseArgs, subject, to }), 'Subject');
		const lines = block.split('\r\n');
		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(78);
		for (const cont of lines.slice(1)) expect(cont.startsWith(' ')).toBe(true);
		expect(unfold(block)).toBe(`Subject: ${subject}`);
	});

	it('keeps every header line inside the 998-octet limit for an unbroken subject', () => {
		const subject = 'x'.repeat(2000);
		const bytes = buildMIME({ ...baseArgs, subject, to });
		const encoder = new TextEncoder();
		for (const line of headerLines(bytes)) {
			expect(encoder.encode(line).length).toBeLessThanOrEqual(998);
		}
		expect(decodeWords(unfold(headerBlock(bytes, 'Subject')))).toBe(`Subject: ${subject}`);
	});

	it('folds a long recipient list without losing a mailbox', () => {
		const many = Array.from({ length: 25 }, (_, i) => ({
			display: `Recipient Number ${i}`,
			address: `person-${i}@thelemail.com`
		}));
		const block = headerBlock(buildMIME({ ...baseArgs, to: many }), 'To');
		for (const line of block.split('\r\n')) expect(line.length).toBeLessThanOrEqual(78);
		expect(mailboxes(unfold(block).slice('To: '.length))).toBe(25);
	});
});

describe('MIME boundaries', () => {
	const to = [{ display: '', address: 'ada@thelemail.com' }];
	const seededRandom = 0.4242424242424242;
	const seededNow = 1786000000000;

	function topBoundary(mime: string): string {
		const m = /boundary="([^"]+)"/.exec(mime);
		expect(m).not.toBeNull();
		return m![1];
	}

	function partsOf(mime: string, boundary: string): string[] {
		const body = mime.split('\r\n\r\n').slice(1).join('\r\n\r\n');
		const segments = body.split(`\r\n--${boundary}`);
		expect(segments.length).toBeGreaterThan(2);
		expect(segments[segments.length - 1].startsWith('--')).toBe(true);
		return segments.slice(1, -1).map((s) => s.replace(/^\r\n/, ''));
	}

	function seedPredictableSources() {
		vi.spyOn(Math, 'random').mockReturnValue(seededRandom);
		vi.spyOn(Date, 'now').mockReturnValue(seededNow);
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('does not repeat between messages when Math.random and the clock are pinned', () => {
		seedPredictableSources();
		const args = { ...baseArgs, to, bodyHtml: '<p>hi</p>' };
		const first = topBoundary(decode(buildMIME(args)));
		const second = topBoundary(decode(buildMIME(args)));
		expect(first).not.toBe(second);
	});

	it('cannot be predicted from Math.random and the clock to split the body', () => {
		seedPredictableSources();
		const guessed = `=_thelemail_alt_${seededNow.toString(36)}_${seededRandom
			.toString(36)
			.slice(2, 12)}`;
		const body =
			`hello\r\n--${guessed}\r\n` +
			`Content-Type: text/html; charset=utf-8\r\n\r\n` +
			`<p>injected</p>\r\n--${guessed}--\r\n`;
		const mime = decode(buildMIME({ ...baseArgs, to, body, bodyHtml: '<p>hi</p>' }));
		const boundary = topBoundary(mime);
		expect(boundary).not.toBe(guessed);
		const parts = partsOf(mime, boundary);
		expect(parts).toHaveLength(2);
		expect(parts[0]).toContain('<p>injected</p>');
		expect(parts[1]).toContain('Content-Transfer-Encoding: base64');
	});

	it('regenerates when the rendered parts already contain the drawn boundary', () => {
		const repeated = '00000000-0000-4000-8000-000000000000';
		let draws = 0;
		vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
			draws++;
			return (draws <= 2
				? repeated
				: `11111111-0000-4000-8000-${String(draws).padStart(12, '0')}`) as ReturnType<
				typeof crypto.randomUUID
			>;
		});
		const body = `hi\r\n--=_thelemail_alt_${repeated}\r\nContent-Type: text/plain\r\n\r\ninjected`;
		const mime = decode(buildMIME({ ...baseArgs, to, body, bodyHtml: '<p>hi</p>' }));
		const boundary = topBoundary(mime);
		expect(draws).toBeGreaterThan(1);
		expect(boundary).not.toContain(repeated);
		expect(partsOf(mime, boundary)).toHaveLength(2);
	});

	it('keeps nested multipart structure intact when the body forges an outer boundary', () => {
		seedPredictableSources();
		const guessed = `=_thelemail_mix_${seededNow.toString(36)}_${seededRandom
			.toString(36)
			.slice(2, 12)}`;
		const mime = decode(
			buildMIME({
				...baseArgs,
				to,
				body: `hello\r\n--${guessed}\r\n\r\ninjected\r\n--${guessed}--`,
				bodyHtml: '<p>hi</p>',
				attachments: [
					{ filename: 'a.txt', contentType: 'text/plain', bytes: new Uint8Array([1, 2, 3]) }
				]
			})
		);
		const boundary = topBoundary(mime);
		const parts = partsOf(mime, boundary);
		expect(parts).toHaveLength(2);
		expect(parts[0]).toContain('multipart/alternative');
		expect(parts[1]).toContain('Content-Disposition: attachment; filename="a.txt"');
	});
});

describe('messageIdDomain', () => {
	it('takes the domain of the sender address', () => {
		expect(messageIdDomain('vlad@thelemail.com')).toBe('thelemail.com');
	});

	it('falls back when the address has no domain', () => {
		expect(messageIdDomain('not-an-address')).toBe('thelemail.local');
		expect(messageIdDomain('trailing@')).toBe('thelemail.local');
	});
});

describe('buildPreview', () => {
	const input: ComposeInput = {
		to: [{ display: 'Ada', address: 'ada@thelemail.com' }],
		cc: [{ display: '', address: 'carol@thelemail.com' }],
		bcc: [{ display: 'Dave', address: 'dave@thelemail.com' }],
		subject: 'Hello',
		body: 'Body text',
		fromEmail: 'vlad@thelemail.com',
		fromName: 'Vlad'
	};
	const now = new Date('2026-08-07T10:00:00Z');

	it('carries true kinds for every recipient when includeBcc is true', () => {
		const p = buildPreview(input, true, now);
		expect(p.recipients).toEqual([
			{ display: 'Ada', address: 'ada@thelemail.com', kind: 'to' },
			{ display: '', address: 'carol@thelemail.com', kind: 'cc' },
			{ display: 'Dave', address: 'dave@thelemail.com', kind: 'bcc' }
		]);
		expect(p.sender).toEqual({ display: 'Vlad', address: 'vlad@thelemail.com' });
		expect(p.subject).toBe('Hello');
		expect(p.display_date).toBe(now.toISOString());
	});

	it('excludes every bcc entry when includeBcc is false', () => {
		const p = buildPreview(input, false, now);
		expect(p.recipients.some((r) => r.kind === 'bcc')).toBe(false);
		expect(p.recipients.map((r) => r.address)).toEqual([
			'ada@thelemail.com',
			'carol@thelemail.com'
		]);
		expect(JSON.stringify(p)).not.toContain('dave@thelemail.com');
	});

	it('truncates the snippet to 280 characters', () => {
		const p = buildPreview({ ...input, body: 'x'.repeat(500) }, true, now);
		expect(p.snippet).toHaveLength(280);
	});
});

describe('sendErrorFromApi', () => {
	function apiError(status: number, message?: string, retryAfterSeconds?: number) {
		const envelope = message
			? { error: { code: 'invalid_request' as const, message, retryAfterSeconds } }
			: null;
		return new ApiCallError(status, envelope, message ?? `HTTP ${status}`);
	}

	it('surfaces the server message on a 4xx instead of the offline copy', () => {
		const e = sendErrorFromApi(apiError(400, 'Recipient list is too long.'), 'Sending failed');
		expect(e.code).toBe('rejected');
		expect(e.message).toBe('Recipient list is too long.');
	});

	it('falls back to a status-bearing message when the envelope has none', () => {
		expect(sendErrorFromApi(apiError(422), 'Sending failed').message).toBe(
			'Sending failed (HTTP 422)'
		);
	});

	it('separates server faults from rejections', () => {
		expect(sendErrorFromApi(apiError(500, 'boom'), 'Sending failed').code).toBe('server_error');
		expect(sendErrorFromApi(apiError(503, 'boom'), 'Sending failed').code).toBe('server_error');
	});

	it('keeps the dedicated codes for 401 and 429', () => {
		expect(sendErrorFromApi(apiError(401, 'expired'), 'Sending failed').code).toBe('locked');
		const limited = sendErrorFromApi(apiError(429, 'slow down', 90), 'Sending failed');
		expect(limited.code).toBe('rate_limited');
		expect(limited.payload).toEqual({ kind: 'rate_limited', retryAfterSeconds: 90 });
	});

	it('reserves the network code for transport failures', () => {
		const e = sendErrorFromApi(new TypeError('Failed to fetch'), 'Sending failed');
		expect(e.code).toBe('network');
		expect(e.message).toBe('Failed to fetch');
	});

	it('passes an existing SendError through untouched', () => {
		const original = new SendError('encrypt', 'nope');
		expect(sendErrorFromApi(original, 'Sending failed')).toBe(original);
	});
});
