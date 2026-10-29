import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SubmissionIntent, SubmitMessageRequest } from '$core/api/types';

const server = vi.hoisted(() => ({
	accounts: new Set<string>(),
	keys: new Map<string, string>(),
	submitted: [] as SubmitMessageRequest[],
	uploads: [] as SubmissionIntent[]
}));

vi.mock('openpgp', () => ({ readKey: vi.fn() }));
vi.mock('$core/directory/lookup', () => ({ lookupDirectory: vi.fn() }));
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
vi.mock('$core/stores/aliasKeys.svelte', () => ({ aliasKeys: { load: async () => {} } }));
vi.mock('$core/stores/accountKeys.svelte', () => ({
	accountKeys: { load: async () => {}, confirm: async () => null }
}));
vi.mock('$core/api/accounts', async () => {
	const { ApiCallError } = await import('$core/api/types');
	return {
		lookupAccount: async (email: string) => {
			if (server.accounts.has(email)) return { accountId: `acct:${email}` };
			throw new ApiCallError(404, null, 'no such account');
		}
	};
});
vi.mock('$core/api/externalKeys', async () => {
	const { ApiCallError } = await import('$core/api/types');
	return {
		lookupExternalKey: async (address: string) => {
			const key = server.keys.get(address.toLowerCase());
			if (!key) throw new ApiCallError(404, null, 'no key');
			return { address, status: 'pinned', fingerprint: `fp:${address}`, armoredKey: key };
		}
	};
});
vi.mock('$core/api/submission', () => ({
	submitExternal: async (req: SubmitMessageRequest) => {
		server.submitted.push(req);
		const intent: SubmissionIntent = {
			intentId: 'intent-1',
			uploadUrl: '/v1/submission/intents/intent-1/message',
			messageId: 'sent-1',
			messageIdHeader: '<sent-1@thelemail.test>',
			date: 'Wed, 23 Sep 2026 10:00:00 +0000',
			from: { name: 'Me', address: 'me@thelemail.test' },
			to: req.to.map((p) => ({ name: p.name, address: p.address })),
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
			maxMessageBytes: 1 << 20,
			recipients: []
		};
		return { kind: 'intent', intent };
	},
	uploadIntentMessage: async (intent: SubmissionIntent) => {
		server.uploads.push(intent);
		return { messageId: intent.messageId, enqueuedAt: new Date().toISOString() };
	}
}));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribe: () => () => {},
		getPublicKey: async () => ({
			ok: true,
			publicKeyArmored: 'key:me',
			fingerprint: new Uint8Array([1, 2, 3])
		}),
		encrypt: async () => ({ ok: true, ciphertext: new Uint8Array([9]) }),
		encryptToKeys: async () => ({ ok: true, armored: '-----PGP-----' })
	}
}));

import { EncStatusTracker } from './encStatus.svelte';
import { dispatchSend } from './sendDispatch';
import type { SendError } from './send';

const LATER = 3 * 60 * 1000;

function send(address: string, tracker: EncStatusTracker) {
	return dispatchSend(
		{
			to: [{ address }],
			subject: 'hi',
			body: 'hello',
			fromEmail: 'me@thelemail.test'
		},
		{ approved: tracker.approvals([address]) }
	);
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
	server.accounts.clear();
	server.keys.clear();
	server.submitted.length = 0;
	server.uploads.length = 0;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('a send whose recipient resolves differently than compose showed', () => {
	it('refuses cleartext to a recipient compose showed as internal', async () => {
		server.accounts.add('bob@thelemail.test');
		const tracker = new EncStatusTracker();
		await tracker.settle(['bob@thelemail.test']);
		expect(tracker.statusFor('bob@thelemail.test')).toBe('internal');

		server.accounts.delete('bob@thelemail.test');
		vi.setSystemTime(Date.now() + LATER);
		const err = await send('bob@thelemail.test', tracker).catch((e) => e);

		expect((err as SendError).code).toBe('encryption_downgrade');
		expect(server.submitted).toHaveLength(0);
		expect(server.uploads).toHaveLength(0);
	});

	it('refuses cleartext to a recipient compose showed as encrypted', async () => {
		server.keys.set('ada@example.org', 'key:ada');
		const tracker = new EncStatusTracker();
		await tracker.settle(['ada@example.org']);
		expect(tracker.statusFor('ada@example.org')).toBe('encrypted');

		server.keys.delete('ada@example.org');
		const err = await send('ada@example.org', tracker).catch((e) => e);

		expect((err as SendError).code).toBe('encryption_downgrade');
		expect(server.submitted).toHaveLength(0);
		expect(server.uploads).toHaveLength(0);
	});

	it('shows the new mode after a re-check and sends once it is approved', async () => {
		server.accounts.add('carl@thelemail.test');
		const tracker = new EncStatusTracker();
		await tracker.settle(['carl@thelemail.test']);
		expect(tracker.statusFor('carl@thelemail.test')).toBe('internal');

		server.accounts.delete('carl@thelemail.test');
		vi.setSystemTime(Date.now() + LATER);
		await send('carl@thelemail.test', tracker).catch(() => {});
		expect(server.uploads).toHaveLength(0);

		tracker.recheck(['carl@thelemail.test']);
		await tracker.settle(['carl@thelemail.test']);
		expect(tracker.statusFor('carl@thelemail.test')).toBe('cleartext');

		await send('carl@thelemail.test', tracker);
		expect(server.uploads).toHaveLength(1);
	});
});
