// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as openpgp from 'openpgp';

const h = vi.hoisted(() => ({
	signerArmored: '',
	signerFingerprint: '',
	seen: new Map<string, { address: string; version: number; keyFingerprint: string; firstSeenAt: number; lastSeenAt: number }>()
}));

vi.mock('./signing-key', () => ({
	get DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED() {
		return h.signerArmored;
	},
	get DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX() {
		return h.signerFingerprint;
	}
}));
vi.mock('./seen-idb', () => ({
	getSeen: async (address: string) => h.seen.get(address) ?? null,
	upsertSeen: async (record: { address: string; version: number; keyFingerprint: string; firstSeenAt: number; lastSeenAt: number }) => {
		h.seen.set(record.address, record);
	}
}));
vi.mock('./tlog/policy', () => ({ TLOG_POLICY: null }));
vi.mock('./tlog/state-idb', () => ({ tlogStateStore: {} }));
vi.mock('$core/api/accounts', () => ({ lookupAccount: vi.fn() }));

import { verifyDirectoryLookup, type DirectoryStatement } from './verify';
import { DirectoryVerificationError } from './errors';
import { canonicalRecipient } from '$core/mail/recipientAddress';

let signer: openpgp.PrivateKey;
const keys: { armored: string; fingerprint: string }[] = [];

function canonical(s: DirectoryStatement): Uint8Array {
	return new TextEncoder().encode(
		JSON.stringify({
			accountId: s.accountId,
			address: s.address,
			issuedAt: s.issuedAt,
			keyAlgorithm: s.keyAlgorithm,
			keyFingerprint: s.keyFingerprint.toLowerCase(),
			signingKeyFingerprint: s.signingKeyFingerprint.toLowerCase(),
			version: s.version
		})
	);
}

async function lookupFor(address: string, keyIndex: number, version: number) {
	const key = keys[keyIndex];
	const statement: DirectoryStatement = {
		address,
		accountId: 'acct-vlad',
		keyFingerprint: key.fingerprint,
		keyAlgorithm: 'openpgp-curve25519-v6',
		version,
		issuedAt: '2026-09-01T00:00:00Z',
		signingKeyFingerprint: h.signerFingerprint
	};
	const sig = await openpgp.sign({
		message: await openpgp.createMessage({ binary: canonical(statement) }),
		signingKeys: signer,
		detached: true,
		format: 'binary'
	});
	return {
		publicKeyArmored: key.armored,
		directoryStatement: statement,
		directorySignature: btoa(String.fromCharCode(...(sig as Uint8Array)))
	};
}

async function failure(p: Promise<unknown>): Promise<string> {
	const err = await p.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(DirectoryVerificationError);
	return (err as DirectoryVerificationError).code;
}

beforeAll(async () => {
	const s = await openpgp.generateKey({ userIDs: [{ email: 'directory@thelemail.test' }], format: 'object' });
	signer = s.privateKey;
	h.signerArmored = s.publicKey.armor();
	h.signerFingerprint = s.publicKey.getFingerprint().toLowerCase();
	for (const email of ['vlad@thelemail.test', 'vlad@thelemail.test']) {
		const k = await openpgp.generateKey({ userIDs: [{ email }], format: 'object' });
		keys.push({ armored: k.publicKey.armor(), fingerprint: k.publicKey.getFingerprint().toLowerCase() });
	}
}, 60_000);

beforeEach(() => {
	h.seen.clear();
});

describe('directory verification for plus-tagged recipients', () => {
	it('verifies a tagged recipient against the base statement and records base history', async () => {
		const lookup = await lookupFor('vlad@thelemail.test', 0, 1);
		const res = await verifyDirectoryLookup(lookup, canonicalRecipient('Vlad+Shop@thelemail.test'));
		expect(res.statement.address).toBe('vlad@thelemail.test');
		expect([...h.seen.keys()]).toEqual(['vlad@thelemail.test']);
	});

	it('rejects a base statement when the requested address was not canonicalized', async () => {
		const lookup = await lookupFor('vlad@thelemail.test', 0, 1);
		expect(await failure(verifyDirectoryLookup(lookup, 'vlad+shop@thelemail.test'))).toBe('address_mismatch');
	});

	it('rejects a statement that names the tag as its own identity', async () => {
		const lookup = await lookupFor('vlad+shop@thelemail.test', 0, 1);
		expect(await failure(verifyDirectoryLookup(lookup, canonicalRecipient('vlad+shop@thelemail.test')))).toBe(
			'address_mismatch'
		);
	});

	it('rejects a substituted identity for another address', async () => {
		const lookup = await lookupFor('vladimir@thelemail.test', 0, 1);
		expect(await failure(verifyDirectoryLookup(lookup, canonicalRecipient('vlad+x@thelemail.test')))).toBe(
			'address_mismatch'
		);
	});

	it('shares key-change detection across tags', async () => {
		await verifyDirectoryLookup(await lookupFor('vlad@thelemail.test', 0, 1), canonicalRecipient('vlad+a@thelemail.test'));
		const changed = await lookupFor('vlad@thelemail.test', 1, 2);
		expect(await failure(verifyDirectoryLookup(changed, canonicalRecipient('vlad+b@thelemail.test')))).toBe(
			'fingerprint_changed'
		);
		expect(await failure(verifyDirectoryLookup(changed, 'vlad@thelemail.test'))).toBe('fingerprint_changed');
	});

	it('shares rollback protection across tags', async () => {
		await verifyDirectoryLookup(await lookupFor('vlad@thelemail.test', 0, 3), 'vlad@thelemail.test');
		const older = await lookupFor('vlad@thelemail.test', 0, 2);
		expect(await failure(verifyDirectoryLookup(older, canonicalRecipient('vlad+x@thelemail.test')))).toBe(
			'version_rolled_back'
		);
	});

	it('rejects a forged signature for a tagged recipient', async () => {
		const lookup = await lookupFor('vlad@thelemail.test', 0, 1);
		lookup.directoryStatement = { ...lookup.directoryStatement, version: 9 };
		expect(await failure(verifyDirectoryLookup(lookup, canonicalRecipient('vlad+x@thelemail.test')))).toBe(
			'signature_invalid'
		);
	});
});
