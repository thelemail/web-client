import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
	keys: {} as Record<string, string>,
	failures: {} as Record<string, string>,
	accepted: [] as { email: string; acceptKeyChange?: boolean }[],
	encrypted: [] as string[],
	slots: [] as { role: string; recipientAccountId?: string; keyFingerprint: string }[],
	puts: [] as string[]
}));

vi.mock('openpgp', () => ({
	readKey: async ({ armoredKey }: { armoredKey: string }) => ({
		getFingerprint: () => armoredKey.replace(/[^0-9a-f]/g, '').padEnd(40, '0').slice(0, 40)
	})
}));
vi.mock('$core/directory/lookup', async () => {
	const { ApiCallError } = await import('$core/api/types');
	return {
		lookupDirectory: async (email: string) => {
			const key = h.keys[email];
			if (!key) throw new ApiCallError(404, null, 'not found');
			return { accountId: `acct-${email.split('@')[0]}`, email, fullName: '', publicKeyArmored: key };
		}
	};
});
vi.mock('$core/api/accounts', async () => {
	const { lookupDirectory } = await import('$core/directory/lookup');
	return { lookupAccount: lookupDirectory };
});
vi.mock('$core/directory/verify', () => {
	class DirectoryVerificationError extends Error {
		details = {};
		constructor(public code: string) {
			super(code);
		}
	}
	return {
		DirectoryVerificationError,
		verifyDirectoryLookup: async (lookup: { email: string }, _: string, opts: { acceptKeyChange?: boolean } = {}) => {
			h.accepted.push({ email: lookup.email, acceptKeyChange: opts.acceptKeyChange });
			const code = h.failures[lookup.email];
			if (code && !(code === 'fingerprint_changed' && opts.acceptKeyChange)) {
				throw new DirectoryVerificationError(code);
			}
			return {};
		}
	};
});
vi.mock('$core/directory/read-delegation', () => ({ verifyReadDelegate: async () => ({}) }));
vi.mock('$core/directory/signing-key', () => ({ DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: '' }));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribe: () => () => {},
		getPublicKey: async () => ({ ok: true, publicKeyArmored: 'me', fingerprint: new Uint8Array(20) }),
		encrypt: async ({ recipientPublicKeyArmored }: { recipientPublicKeyArmored: string }) => {
			h.encrypted.push(recipientPublicKeyArmored);
			return { ok: true, ciphertext: new TextEncoder().encode(`for ${recipientPublicKeyArmored}`) };
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
	issueAttachmentUploadUrls: async (req: { slots: ({ slotId: string } & (typeof h.slots)[number])[] }) => {
		h.slots.push(...req.slots);
		return {
			slots: req.slots.map((s) => ({
				slotId: s.slotId,
				objectKey: `obj-${s.slotId}`,
				putUrl: `https://blob.test/${s.slotId}`,
				putPath: `/v1/attachments/uploads?objectKey=obj-${s.slotId}`,
				putHeaders: {}
			}))
		};
	}
}));
vi.mock('$core/api/client', () => ({
	apiBlobPut: async (path: string) => {
		h.puts.push(path);
	}
}));

import { UploadOrchestrator, type Attachment } from './attachmentUpload';
import { bytesToB64, hexToBytes } from '$core/crypto';

function fingerprintOf(key: string): string {
	return bytesToB64(hexToBytes(key.replace(/[^0-9a-f]/g, '').padEnd(40, '0').slice(0, 40)));
}

function attachment(): Attachment {
	return {
		id: crypto.randomUUID(),
		file: new File([new Uint8Array([1, 2, 3])], 'a.bin', { type: 'application/octet-stream' }),
		status: 'queued',
		progress: 0,
		disposition: 'attachment'
	};
}

async function uploaded(orchestrator: UploadOrchestrator, recipients: string[] = []): Promise<Attachment> {
	const att = attachment();
	await orchestrator.startUpload(att, recipients, 0);
	expect(att.status).toBe('ready');
	reset();
	return att;
}

function reset() {
	h.accepted.length = 0;
	h.encrypted.length = 0;
	h.slots.length = 0;
	h.puts.length = 0;
}

beforeEach(() => {
	h.keys = { 'ada@thelemail.test': 'key-ada-1', 'bob@thelemail.test': 'key-bob-1' };
	h.failures = {};
	reset();
});

describe('recipient attachment copies', () => {
	it('encrypts and uploads nothing for a recipient whose key fails directory verification', async () => {
		const orchestrator = new UploadOrchestrator(() => {}, 'acct-me');
		const att = await uploaded(orchestrator);
		h.failures['ada@thelemail.test'] = 'signature_invalid';

		await expect(
			orchestrator.ensureRecipientCopies([att], ['ada@thelemail.test'])
		).rejects.toMatchObject({ code: 'directory_verification_failed' });
		expect(h.encrypted).toEqual([]);
		expect(h.slots).toEqual([]);
		expect(h.puts).toEqual([]);
	});

	it('waits for the user to accept a changed key before uploading', async () => {
		const orchestrator = new UploadOrchestrator(() => {}, 'acct-me');
		const att = await uploaded(orchestrator);
		h.failures['ada@thelemail.test'] = 'fingerprint_changed';

		await expect(
			orchestrator.ensureRecipientCopies([att], ['ada@thelemail.test'])
		).rejects.toMatchObject({ code: 'tofu' });
		expect(h.encrypted).toEqual([]);
		expect(h.puts).toEqual([]);

		await orchestrator.ensureRecipientCopies([att], ['ada@thelemail.test'], { acceptKeyChange: true });
		expect(h.encrypted).toEqual(['key-ada-1']);
		expect(h.slots).toMatchObject([
			{ role: 'recipient', recipientAccountId: 'acct-ada', keyFingerprint: fingerprintOf('key-ada-1') }
		]);
		expect(att.recipientDescriptors?.get('acct-ada')?.keyFingerprint).toBe(fingerprintOf('key-ada-1'));
		expect(h.puts.length).toBeGreaterThan(0);
		expect(h.puts.every((path) => path.startsWith('/v1/attachments/uploads?objectKey='))).toBe(true);
	});

	it('uploads only the sender copy when a recipient does not verify at attach time', async () => {
		h.failures['ada@thelemail.test'] = 'signature_invalid';
		const orchestrator = new UploadOrchestrator(() => {}, 'acct-me');
		const att = attachment();
		await orchestrator.startUpload(att, ['ada@thelemail.test', 'bob@thelemail.test'], 0);

		expect(att.status).toBe('ready');
		expect(h.encrypted).toEqual(['me', 'key-bob-1']);
		expect(h.slots.map((s) => s.recipientAccountId)).toEqual([undefined, 'acct-bob']);
		expect(att.recipientDescriptors?.has('acct-ada')).toBe(false);
	});

	it('re-encrypts a copy made to a key the directory no longer serves', async () => {
		const orchestrator = new UploadOrchestrator(() => {}, 'acct-me');
		const att = await uploaded(orchestrator, ['ada@thelemail.test', 'bob@thelemail.test']);
		h.keys['ada@thelemail.test'] = 'key-ada-2';

		await orchestrator.ensureRecipientCopies([att], ['ada@thelemail.test', 'bob@thelemail.test']);
		expect(h.encrypted).toEqual(['key-ada-2']);
		expect(att.recipientDescriptors?.get('acct-ada')?.keyFingerprint).toBe(fingerprintOf('key-ada-2'));
		expect(att.recipientDescriptors?.get('acct-bob')?.keyFingerprint).toBe(fingerprintOf('key-bob-1'));
	});

	it('skips addresses without an account', async () => {
		const orchestrator = new UploadOrchestrator(() => {}, 'acct-me');
		const att = await uploaded(orchestrator);

		await orchestrator.ensureRecipientCopies([att], ['ada@thelemail.test', 'someone@example.org']);
		expect(h.encrypted).toEqual(['key-ada-1']);
		expect([...(att.recipientDescriptors?.keys() ?? [])]).toEqual(['acct-ada']);
	});
});
