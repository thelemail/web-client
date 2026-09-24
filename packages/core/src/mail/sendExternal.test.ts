import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubmissionIntent, SubmitMessageRequest } from '$core/api/types';

const encryptToKeysCalls: string[][] = [];
const submitted: SubmitMessageRequest[] = [];
const uploads: { intent: SubmissionIntent; message: Blob }[] = [];

function intentFor(req: SubmitMessageRequest): SubmissionIntent {
	return {
		intentId: 'intent-1',
		uploadUrl: '/v1/submission/intents/intent-1/message',
		messageId: 'sent-1',
		messageIdHeader: '<sent-1@thelemail.test>',
		date: 'Wed, 23 Sep 2026 10:00:00 +0000',
		from: { name: 'Me "the sender"', address: 'me@thelemail.test' },
		to: req.to.map((p) => ({ name: p.name, address: p.address })),
		cc: req.cc?.map((p) => ({ name: p.name, address: p.address })),
		inReplyTo: '<parent@example.org>',
		references: ['<root@example.org>', '<parent@example.org>'],
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		maxMessageBytes: 1 << 20,
		recipients: []
	};
}

vi.mock('openpgp', () => ({ readKey: vi.fn() }));
vi.mock('$core/directory/lookup', () => ({
	lookupDirectory: vi.fn()
}));
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: vi.fn(),
	DirectoryVerificationError: class extends Error {}
}));
vi.mock('$core/directory/read-delegation', () => ({ verifyReadDelegate: async () => ({}) }));
vi.mock('$core/directory/signing-key', () => ({ DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: '' }));
vi.mock('./signaturePack', () => ({
	packBodyForSend: async (bodyHtml: string | undefined) => ({ bodyHtml, relatedParts: [] })
}));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: 'acct-1', email: 'me@thelemail.test', fullName: 'Me' }
}));
vi.mock('$core/api/externalKeys', () => ({
	lookupExternalKey: async (address: string) => ({
		address,
		status: 'known',
		fingerprint: `fp:${address}`,
		armoredKey: address.startsWith('keyless') ? '' : `key:${address}`
	})
}));
vi.mock('$core/api/submission', () => ({
	submitExternal: async (req: SubmitMessageRequest) => {
		submitted.push(req);
		const covered = new Set((req.encryptedCopies ?? []).flatMap((c) => c.addresses));
		const all = [...req.to, ...(req.cc ?? []), ...(req.bcc ?? [])];
		if (all.some((p) => !covered.has(p.address))) {
			return { kind: 'intent', intent: intentFor(req) };
		}
		return { kind: 'accepted', response: { messageId: 'msg-1', enqueuedAt: new Date().toISOString() } };
	},
	uploadIntentMessage: async (intent: SubmissionIntent, message: Blob) => {
		uploads.push({ intent, message });
		return { messageId: intent.messageId, enqueuedAt: new Date().toISOString() };
	}
}));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribe: () => () => {},
		encryptToKeys: async (args: { recipientPublicKeysArmored: string[] }) => {
			encryptToKeysCalls.push(args.recipientPublicKeysArmored);
			return { ok: true, armored: `-----PGP[${args.recipientPublicKeysArmored.join(',')}]-----` };
		}
	}
}));

import { sendExternalMessage, encryptionGroups, type KeyedRecipient } from './sendExternal';

function party(address: string) {
	return { display: address, address };
}

function keyed(address: string): KeyedRecipient {
	return { address, display: address, armoredKey: `key:${address}`, fingerprint: `fp:${address}` };
}

beforeEach(() => {
	encryptToKeysCalls.length = 0;
	submitted.length = 0;
	uploads.length = 0;
});

describe('encryptionGroups', () => {
	it('keeps to/cc in one group and isolates each bcc recipient', () => {
		const groups = encryptionGroups(
			[keyed('a@x.test'), keyed('b@x.test'), keyed('c@x.test'), keyed('d@x.test')],
			[party('a@x.test'), party('b@x.test')]
		);
		expect(groups).toEqual([
			{ addresses: ['a@x.test', 'b@x.test'], armoredKeys: ['key:a@x.test', 'key:b@x.test'] },
			{ addresses: ['c@x.test'], armoredKeys: ['key:c@x.test'] },
			{ addresses: ['d@x.test'], armoredKeys: ['key:d@x.test'] }
		]);
	});

	it('treats an address that is also in to/cc as visible', () => {
		const groups = encryptionGroups([keyed('A@x.test')], [party('a@x.test')]);
		expect(groups).toEqual([{ addresses: ['A@x.test'], armoredKeys: ['key:A@x.test'] }]);
	});

	it('produces only blind groups when every recipient is bcc', () => {
		const groups = encryptionGroups([keyed('c@x.test'), keyed('d@x.test')], []);
		expect(groups).toEqual([
			{ addresses: ['c@x.test'], armoredKeys: ['key:c@x.test'] },
			{ addresses: ['d@x.test'], armoredKeys: ['key:d@x.test'] }
		]);
	});
});

describe('sendExternalMessage encrypted copies', () => {
	it('never encrypts a to/cc copy to a bcc recipient key', async () => {
		await sendExternalMessage({
			to: [party('to@x.test')],
			cc: [party('cc@x.test')],
			bcc: [party('bcc1@x.test'), party('bcc2@x.test')],
			subject: 'hi',
			body: 'hello',
			sentMessageId: '00000000-0000-4000-8000-000000000001'
		});

		const req = submitted[0];
		const copies = req.encryptedCopies ?? [];
		expect(copies).toHaveLength(3);

		const bcc = new Set(['bcc1@x.test', 'bcc2@x.test']);
		const visible = copies.filter((c) => c.addresses.some((a) => !bcc.has(a)));
		expect(visible).toHaveLength(1);
		expect(visible[0].addresses).toEqual(['to@x.test', 'cc@x.test']);
		for (const address of bcc) {
			expect(visible[0].encryptedBody).not.toContain(`key:${address}`);
		}

		for (const address of bcc) {
			const own = copies.filter((c) => c.addresses.includes(address));
			expect(own).toHaveLength(1);
			expect(own[0].addresses).toEqual([address]);
			for (const other of [...bcc, 'to@x.test', 'cc@x.test']) {
				if (other === address) continue;
				expect(own[0].encryptedBody).not.toContain(`key:${other}`);
			}
		}

		expect(req.encryptedCopies?.flatMap((c) => c.addresses).sort()).toEqual([
			'bcc1@x.test',
			'bcc2@x.test',
			'cc@x.test',
			'to@x.test'
		]);
	});

	it('carries display names into to/cc/bcc and omits them when absent', async () => {
		await sendExternalMessage({
			to: [
				{ display: 'Vlad Gorokhov', address: 'to@x.test' },
				{ display: '', address: 'bare@x.test' }
			],
			cc: [{ display: 'Carol', address: 'cc@x.test' }],
			bcc: [party('bcc@x.test')],
			subject: 'hi',
			body: 'hello',
			sentMessageId: '00000000-0000-4000-8000-000000000003'
		});

		const req = submitted[0];
		expect(req.to).toEqual([
			{ name: 'Vlad Gorokhov', address: 'to@x.test' },
			{ address: 'bare@x.test' }
		]);
		expect(req.cc).toEqual([{ name: 'Carol', address: 'cc@x.test' }]);
		expect(req.bcc).toEqual([{ address: 'bcc@x.test' }]);
		expect(req.encryptedCopies?.[0].addresses).toEqual(['to@x.test', 'bare@x.test', 'cc@x.test']);
	});

	it('sends a single copy when there is no bcc', async () => {
		await sendExternalMessage({
			to: [party('to@x.test')],
			cc: [party('cc@x.test')],
			subject: 'hi',
			body: 'hello',
			sentMessageId: '00000000-0000-4000-8000-000000000002'
		});

		const copies = submitted[0].encryptedCopies ?? [];
		expect(copies).toHaveLength(1);
		expect(copies[0].addresses).toEqual(['to@x.test', 'cc@x.test']);
		expect(encryptToKeysCalls).toEqual([['key:to@x.test', 'key:cc@x.test']]);
	});
});

function headerOf(mime: string, name: string): string | undefined {
	const block = mime.slice(0, mime.indexOf('\r\n\r\n')).replace(/\r\n[ \t]/g, ' ');
	const line = block.split('\r\n').find((l) => l.toLowerCase().startsWith(name.toLowerCase() + ':'));
	return line?.slice(name.length + 1).trim();
}

describe('sendExternalMessage cleartext leg', () => {
	it('uploads recipient MIME that carries the issued headers and no inline body in the request', async () => {
		const pdf = new File([new Uint8Array(200_000).map((_, i) => i % 251)], 'invoice.pdf', { type: 'application/pdf' });
		const out = await sendExternalMessage({
			to: [{ display: 'Keyless Person', address: 'keyless@example.org' }],
			bcc: [party('keyless-blind@example.org')],
			subject: 'Rechnung für Mai',
			body: 'Hallo,\nanbei die Rechnung.\n',
			bodyHtml: '<p>Hallo</p>',
			sentMessageId: '00000000-0000-4000-8000-000000000009',
			attachments: [{ file: pdf, disposition: 'attachment' } as never]
		});
		expect(out.messageId).toBe('sent-1');

		const req = submitted[0] as unknown as Record<string, unknown>;
		for (const gone of ['textBody', 'htmlBody', 'calendar', 'stagedAttachments']) {
			expect(req).not.toHaveProperty(gone);
		}

		expect(uploads).toHaveLength(1);
		const { intent, message } = uploads[0];
		expect(message.type).toBe('message/rfc822');
		const bytes = new Uint8Array(await message.arrayBuffer());
		expect(bytes.every((b) => b < 0x80 && b !== 0)).toBe(true);
		const mime = new TextDecoder().decode(bytes);
		expect(mime).not.toMatch(/(^|[^\r])\n/);
		expect(mime).not.toMatch(/\r(?!\n)/);
		for (const line of mime.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);

		expect(headerOf(mime, 'Date')).toBe(intent.date);
		expect(headerOf(mime, 'Message-ID')).toBe(intent.messageIdHeader);
		expect(headerOf(mime, 'In-Reply-To')).toBe('<parent@example.org>');
		expect(headerOf(mime, 'References')).toBe('<root@example.org> <parent@example.org>');
		expect(headerOf(mime, 'From')).toMatch(/^=\?utf-8\?B\?.+\?= <me@thelemail\.test>$/);
		expect(headerOf(mime, 'Bcc')).toBeUndefined();
		expect(mime).not.toContain('keyless-blind@example.org');
		expect(headerOf(mime, 'To')).toBe('"Keyless Person" <keyless@example.org>');

		const expectedB64 = Buffer.from(await pdf.arrayBuffer()).toString('base64');
		const partStart = mime.indexOf('filename="invoice.pdf"');
		const body = mime.slice(mime.indexOf('\r\n\r\n', partStart) + 4);
		const encoded = body.slice(0, body.indexOf('\r\n--')).replace(/\r\n/g, '');
		expect(encoded).toBe(expectedB64);
		expect(mime).toContain('Content-Transfer-Encoding: quoted-printable');
		expect(mime).toContain('Hallo,\r\nanbei die Rechnung.');
		expect(headerOf(mime, 'Subject')).toMatch(/^=\?utf-8\?B\?/);
	});

	it('keeps encrypted copies and the cleartext leg in one send', async () => {
		await sendExternalMessage({
			to: [party('keyed@example.org'), party('keyless@example.org')],
			subject: 'mixed',
			body: 'hello',
			sentMessageId: '00000000-0000-4000-8000-00000000000a'
		});
		expect(submitted[0].encryptedCopies?.[0].addresses).toEqual(['keyed@example.org']);
		expect(uploads).toHaveLength(1);
	});

	it('refuses to upload a message over the intent limit', async () => {
		const big = new File([new Uint8Array(900_000)], 'big.bin');
		await expect(
			sendExternalMessage({
				to: [party('keyless@example.org')],
				subject: 'big',
				body: 'x',
				sentMessageId: '00000000-0000-4000-8000-00000000000b',
				attachments: [{ file: big, disposition: 'attachment' } as never]
			})
		).rejects.toMatchObject({ code: 'rejected' });
		expect(uploads).toHaveLength(0);
	});
});
