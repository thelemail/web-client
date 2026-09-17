import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
	requests: [] as {
		recipients: { accountId: string; envelope: { encryptedBody: string } }[];
		sent: { encryptedBody: string };
		forwardCopies?: { readDelegationId: string; recipientAccountId: string; encryptedMessage: string }[];
		forwardReplyTo?: string;
	}[],
	encryptedToKeys: [] as { keys: string[]; plaintext: string; aliasId?: string }[],
	delegates: {} as Record<string, { id: string; publicKeyArmored: string; statement: string; statementSignature: string }[]>,
	rejected: new Set<string>()
}));

vi.mock('openpgp', () => ({
	readKey: async ({ armoredKey }: { armoredKey: string }) => ({
		getFingerprint: () => armoredKey.replace(/[^0-9a-f]/g, '').padEnd(40, '0').slice(0, 40)
	})
}));
vi.mock('$core/directory/lookup', () => ({
	lookupDirectory: async (email: string) => {
		const accountId = `acct-${email.split('@')[0]}`;
		return {
			accountId,
			email,
			fullName: '',
			publicKeyArmored: `key-${accountId}`,
			readDelegates: h.delegates[email]
		};
	}
}));
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: async () => ({}),
	DirectoryVerificationError: class extends Error {}
}));
vi.mock('$core/directory/read-delegation', () => ({
	verifyReadDelegate: async (d: { id: string }) => {
		if (h.rejected.has(d.id)) throw new Error('signature_invalid');
		return {};
	}
}));
vi.mock('$core/directory/signing-key', () => ({ DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: '' }));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribe: () => () => {},
		getPublicKey: async () => ({ ok: true, publicKeyArmored: 'me', fingerprint: new Uint8Array(20) }),
		encrypt: async ({ plaintext }: { plaintext: Uint8Array }) => ({ ok: true, ciphertext: plaintext }),
		encryptToKeys: async (args: { recipientPublicKeysArmored: string[]; plaintext: Uint8Array; aliasId?: string }) => {
			h.encryptedToKeys.push({
				keys: args.recipientPublicKeysArmored,
				plaintext: new TextDecoder().decode(args.plaintext),
				aliasId: args.aliasId
			});
			return { ok: true, armored: `-----BEGIN PGP MESSAGE-----\nfor ${args.recipientPublicKeysArmored.join(',')}` };
		}
	}
}));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: 'acct-me', email: 'me@thelemail.test', fullName: 'Me' }
}));
vi.mock('./signaturePack', () => ({
	packBodyForSend: async (bodyHtml: string | undefined) => ({ bodyHtml, relatedParts: [] })
}));
vi.mock('$core/api/messages', () => ({
	sendInternal: async (req: (typeof h.requests)[number]) => {
		h.requests.push(req);
		return { messageId: 'm1', storedAt: '' };
	}
}));

import { sendInternalMessage } from './send';

const party = (address: string) => ({ display: '', address });

function delegate(id: string) {
	return { id, publicKeyArmored: `delegate-key-${id}`, statement: '', statementSignature: '' };
}

beforeEach(() => {
	h.requests.length = 0;
	h.encryptedToKeys.length = 0;
	h.delegates = {};
	h.rejected.clear();
});

describe('internal send to an address with read delegates', () => {
	it('adds one copy per verified delegate, encrypted to that key only', async () => {
		h.delegates['contact@acme.test'] = [delegate('d1')];
		const file = new File([new Uint8Array([37, 80, 68, 70])], 'invoice.pdf', { type: 'application/pdf' });
		await sendInternalMessage({
			to: [party('contact@acme.test')],
			bcc: [party('secret@thelemail.test')],
			subject: 'Invoice',
			body: 'see attached',
			fromEmail: 'billing@acme.test',
			fromAliasId: 'alias-1',
			attachments: [
				{
					id: 'a1',
					file,
					status: 'done',
					progress: 1,
					disposition: 'attachment',
					senderDescriptor: { ordinal: 0 } as never,
					recipientDescriptors: new Map([
						['acct-contact', { ordinal: 0 } as never],
						['acct-secret', { ordinal: 0 } as never]
					])
				} as never
			]
		});
		const req = h.requests[0];
		expect(req.forwardCopies).toEqual([
			{ readDelegationId: 'd1', recipientAccountId: 'acct-contact', encryptedMessage: expect.stringContaining('delegate-key-d1') }
		]);
		expect(req.forwardReplyTo).toBe('billing@acme.test');
		expect(h.encryptedToKeys).toHaveLength(1);
		const copy = h.encryptedToKeys[0];
		expect(copy.keys).toEqual(['delegate-key-d1']);
		expect(copy.aliasId).toBe('alias-1');
		expect(copy.plaintext).toContain('Subject: Invoice');
		expect(copy.plaintext).toContain('filename="invoice.pdf"');
		expect(copy.plaintext).toContain('JVBERg==');
		expect(copy.plaintext).not.toContain('secret@thelemail.test');
	});

	it('skips delegates that do not verify and still sends', async () => {
		h.delegates['contact@acme.test'] = [delegate('good'), delegate('forged')];
		h.rejected.add('forged');
		await sendInternalMessage({ to: [party('contact@acme.test')], subject: 's', body: 'b' });
		expect(h.requests[0].forwardCopies?.map((c) => c.readDelegationId)).toEqual(['good']);
	});

	it('sends no forward fields when nobody forwards', async () => {
		await sendInternalMessage({ to: [party('ada@thelemail.test')], subject: 's', body: 'b' });
		expect(h.requests[0].forwardCopies).toBeUndefined();
		expect(h.requests[0].forwardReplyTo).toBeUndefined();
		expect(h.encryptedToKeys).toHaveLength(0);
	});

	it('encrypts once per delegate even when the address appears twice', async () => {
		h.delegates['contact@acme.test'] = [delegate('d1')];
		await sendInternalMessage({ to: [party('contact@acme.test')], cc: [party('contact+x@acme.test')], subject: 's', body: 'b' });
		expect(h.requests[0].forwardCopies).toHaveLength(1);
	});
});
