import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
	accept: [] as (string | undefined)[],
	failure: null as null | { code: string; details: Record<string, unknown> }
}));

vi.mock('openpgp', () => ({
	readKey: async () => ({ getFingerprint: () => 'ab'.repeat(32) })
}));
vi.mock('$core/directory/lookup', () => ({
	lookupDirectory: async (email: string) => ({
		accountId: 'acct-unsigned',
		email,
		fullName: 'Ada',
		publicKeyArmored: 'key'
	})
}));
vi.mock('$core/directory/verify', async () => {
	const { DirectoryVerificationError } = await import('$core/directory/errors');
	return {
		DirectoryVerificationError,
		verifyDirectoryLookup: async (_lookup: unknown, _addr: string, opts: { acceptFingerprint?: string } = {}) => {
			h.accept.push(opts.acceptFingerprint);
			if (h.failure && !opts.acceptFingerprint) {
				throw new DirectoryVerificationError(h.failure.code as never, 'failed', h.failure.details);
			}
			return { statement: { accountId: 'acct-signed' } };
		}
	};
});
vi.mock('$core/directory/read-delegation', () => ({ verifyReadDelegate: async () => ({}) }));
vi.mock('$core/directory/signing-key', () => ({ DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: 'cd'.repeat(32) }));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribe: () => () => {} } }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: null, email: null, fullName: null } }));
vi.mock('./signaturePack', () => ({
	packBodyForSend: async (bodyHtml: string | undefined) => ({ bodyHtml, relatedParts: [] })
}));

import { externalKeyChangePayload, resolveRecipient, SendError } from './send';

beforeEach(() => {
	h.accept.length = 0;
	h.failure = null;
});

async function failure(p: Promise<unknown>): Promise<SendError> {
	const err = await p.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(SendError);
	return err as SendError;
}

describe('recipient trust on send', () => {
	it('takes the recipient account from the signed statement, not the lookup envelope', async () => {
		const r = await resolveRecipient('ada@thelemail.test');
		expect(r.accountId).toBe('acct-signed');
	});

	it('offers the exact fingerprint the user saw when the key changed', async () => {
		h.failure = {
			code: 'fingerprint_changed',
			details: {
				previousFingerprint: '11'.repeat(32),
				currentFingerprint: '22'.repeat(32),
				previousVersion: 3,
				currentVersion: 4,
				previousVerifiedAtMillis: Date.UTC(2026, 1, 14)
			}
		};
		const err = await failure(resolveRecipient('Ada+news@thelemail.test'));
		expect(err.code).toBe('tofu');
		expect(err.payload).toMatchObject({
			kind: 'tofu',
			address: 'ada@thelemail.test',
			currentFingerprintHex: '22'.repeat(32),
			previousLastSeen: '14 Feb 2026 · v3'
		});
		await resolveRecipient('ada@thelemail.test', {
			acceptedKeys: new Map([['ada@thelemail.test', '22'.repeat(32)]])
		});
		expect(h.accept.at(-1)).toBe('22'.repeat(32));
	});

	it('accepts a fingerprint only for the address it was confirmed for', async () => {
		await resolveRecipient('bob@thelemail.test', {
			acceptedKeys: new Map([['ada@thelemail.test', '22'.repeat(32)]])
		});
		expect(h.accept).toEqual([undefined]);
	});

	it('reports a pending log entry as a directory failure the user can retry', async () => {
		h.failure = { code: 'tlog_pending', details: { previousFingerprint: '11'.repeat(32) } };
		const err = await failure(resolveRecipient('ada@thelemail.test'));
		expect(err.code).toBe('directory_verification_failed');
		expect(err.inner).toBe('tlog_pending');
		expect(err.payload).toMatchObject({ kind: 'directory', previousFingerprint: expect.stringContaining('1111') });
	});

	it('shows external key changes in hex and keeps base64 for the accept call', () => {
		const fp = btoa(String.fromCharCode(...new Uint8Array(32).fill(0xab)));
		const prev = btoa(String.fromCharCode(...new Uint8Array(20).fill(0x01)));
		const payload = externalKeyChangePayload('x@example.org', {
			address: 'x@example.org',
			fingerprint: fp,
			algorithm: 'ed25519',
			armoredKey: '',
			source: 'wkd',
			status: 'changed',
			firstSeenAt: '2026-10-01T00:00:00Z',
			previousFingerprint: prev,
			previousFirstSeenAt: '2026-02-14T09:00:00Z'
		});
		expect(payload).toMatchObject({
			kind: 'external-key-change',
			currentFingerprint: expect.stringMatching(/^ABAB ABAB/),
			currentFingerprintB64: fp,
			previousFingerprint: expect.stringMatching(/^0101 0101/),
			previousFirstSeen: '14 Feb 2026'
		});
	});
});
