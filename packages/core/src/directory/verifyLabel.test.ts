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
import { generateCurve25519Key } from '$core/keys/pgpKeys';

let signer: openpgp.PrivateKey;

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

async function signedLookup(key: openpgp.PublicKey, keyAlgorithm: string, issuedAt: string) {
	const statement: DirectoryStatement = {
		address: 'anna@thelemail.test',
		accountId: 'acct-anna',
		keyFingerprint: key.getFingerprint().toLowerCase(),
		keyAlgorithm,
		version: 1,
		issuedAt,
		signingKeyFingerprint: h.signerFingerprint
	};
	const sig = await openpgp.sign({
		message: await openpgp.createMessage({ binary: canonical(statement) }),
		signingKeys: signer,
		detached: true,
		format: 'binary'
	});
	return {
		publicKeyArmored: key.armor(),
		directoryStatement: statement,
		directorySignature: btoa(String.fromCharCode(...(sig as Uint8Array)))
	};
}

async function outcome(key: openpgp.PublicKey, label: string, issuedAt: string): Promise<string> {
	h.seen.clear();
	try {
		await verifyDirectoryLookup(await signedLookup(key, label, issuedAt), 'anna@thelemail.test');
		return 'ok';
	} catch (e) {
		if (e instanceof DirectoryVerificationError) return e.code;
		throw e;
	}
}

const date = new Date(Date.now() - 60_000);
let v6Key: openpgp.PublicKey;
let v4Key: openpgp.PublicKey;

beforeAll(async () => {
	const s = await openpgp.generateKey({ userIDs: [{ email: 'directory@thelemail.test' }], format: 'object' });
	signer = s.privateKey;
	h.signerArmored = s.publicKey.armor();
	h.signerFingerprint = s.publicKey.getFingerprint().toLowerCase();
	v6Key = (await generateCurve25519Key({ userIDs: [{ email: 'anna@thelemail.test' }], date })).publicKey;
	v4Key = (
		await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'anna@thelemail.test' }], date, format: 'object' })
	).publicKey;
});

beforeEach(() => h.seen.clear());

describe('directory key label', () => {
	it('accepts the label the server derives from the served key', async () => {
		expect(await outcome(v6Key, 'openpgp-curve25519-v6', '2026-10-01T00:00:00Z')).toBe('ok');
		expect(await outcome(v4Key, 'openpgp-curve25519-v4', '2026-10-01T00:00:00Z')).toBe('ok');
	});

	it('keeps accepting a v4 key under the old v6 label on statements issued before the cutoff', async () => {
		expect(await outcome(v4Key, 'openpgp-curve25519-v6', '2026-09-01T00:00:00Z')).toBe('ok');
	});

	it('rejects the old v6 label on a v4 key after the cutoff', async () => {
		expect(await outcome(v4Key, 'openpgp-curve25519-v6', '2026-10-01T00:00:00Z')).toBe('algorithm_mismatch');
	});

	it('rejects a label that claims less than the served key or nothing known', async () => {
		expect(await outcome(v6Key, 'openpgp-curve25519-v4', '2026-09-01T00:00:00Z')).toBe('algorithm_mismatch');
		expect(await outcome(v6Key, 'openpgp-rsa', '2026-10-01T00:00:00Z')).toBe('algorithm_mismatch');
	});
});
