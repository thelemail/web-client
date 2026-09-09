import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubmitMessageRequest } from '$lib/api/types';

const encryptToKeysCalls: string[][] = [];
const submitted: SubmitMessageRequest[] = [];

vi.mock('openpgp', () => ({ readKey: vi.fn() }));
vi.mock('$lib/directory/verify', () => ({
	verifyDirectoryLookup: vi.fn(),
	DirectoryVerificationError: class extends Error {}
}));
vi.mock('$lib/directory/signing-key', () => ({ DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: '' }));
vi.mock('./signaturePack', () => ({
	packBodyForSend: async (bodyHtml: string | undefined) => ({ bodyHtml, relatedParts: [] })
}));
vi.mock('$lib/stores/auth.svelte', () => ({
	auth: { accountId: 'acct-1', email: 'me@thelemail.test', fullName: 'Me' }
}));
vi.mock('$lib/api/externalKeys', () => ({
	lookupExternalKey: async (address: string) => ({
		address,
		status: 'known',
		fingerprint: `fp:${address}`,
		armoredKey: `key:${address}`
	})
}));
vi.mock('$lib/api/submission', () => ({
	issueStagingUrls: async () => ({ slots: [] }),
	submitExternal: async (req: SubmitMessageRequest) => {
		submitted.push(req);
		return { messageId: 'msg-1', enqueuedAt: new Date().toISOString() };
	}
}));
vi.mock('$lib/keystore/keystore-client', () => ({
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
