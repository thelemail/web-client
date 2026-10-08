// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as openpgp from 'openpgp';
import type { TlogRuntimePolicy } from './tlog/policy';

const h = vi.hoisted(() => ({
	signerArmored: '',
	signerFingerprint: '',
	policy: { value: null as TlogRuntimePolicy | null },
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
vi.mock('./tlog/policy', () => ({
	get TLOG_POLICY() {
		return h.policy.value;
	}
}));
vi.mock('./tlog/state-idb', () => ({ tlogStateStore: {} }));
vi.mock('$core/api/accounts', () => ({ lookupAccount: vi.fn() }));

import { verifyDirectoryLookup, type DirectoryStatement, type LookupInputForVerification } from './verify';
import { DirectoryVerificationError } from './errors';

const PINNED: Omit<TlogRuntimePolicy, 'mode'> = {
	origin: 'thelemail.com/keys',
	logVerifierKey: 'thelemail.com/keys+76ead63c+ASduViYkPgYHzuTuDnuTdEkjR/DIprnavuFA3vom4YZT',
	vrfPublicKey: 'AFye6B/Tm9oZVs25OmoSyDWn16PFdnIhG2vpOJGSzEE=',
	witnessVerifierKeys: [
		'witness.navigli.sunlight.geomys.org+a3e00fe2+BNy/co4C1Hn1p+INwJrfUlgz7W55dSZReusH/GhUhJ/G',
		'witness.stagemole.eu+67f7aea0+BEqSG3yu9YrmcM3BHvQYTxwFj3uSWakQepafafpUqklv',
		'staging.witness.transparency.goog/ring-any-bells+2e1a8dc9+BG5JTpLc3FJtwzgh1Uv+Qelz9qeOH2bfWjS1s0s+y4rL'
	],
	witnessThreshold: 2,
	maxCosignatureAgeSeconds: 86400
};

let signer: openpgp.PrivateKey;
let key: { armored: string; fingerprint: string };

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

async function signedLookup(tlogProof?: string): Promise<LookupInputForVerification> {
	const statement: DirectoryStatement = {
		address: 'vlad@thelemail.test',
		accountId: 'acct-vlad',
		keyFingerprint: key.fingerprint,
		keyAlgorithm: 'openpgp-curve25519-v6',
		version: 1,
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
		directorySignature: btoa(String.fromCharCode(...(sig as Uint8Array))),
		tlogProof
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
	const k = await openpgp.generateKey({ userIDs: [{ email: 'vlad@thelemail.test' }], format: 'object' });
	key = { armored: k.publicKey.armor(), fingerprint: k.publicKey.getFingerprint().toLowerCase() };
}, 60_000);

beforeEach(() => {
	h.seen.clear();
});

describe('transparency log policy mode', () => {
	it('enforce rejects a lookup that carries no log proof', async () => {
		h.policy.value = { ...PINNED, mode: 'enforce' };
		expect(await failure(verifyDirectoryLookup(await signedLookup(), 'vlad@thelemail.test'))).toBe(
			'tlog_proof_missing'
		);
		expect(h.seen.size).toBe(0);
	});

	it('enforce rejects a lookup whose log proof cannot be parsed', async () => {
		h.policy.value = { ...PINNED, mode: 'enforce' };
		expect(await failure(verifyDirectoryLookup(await signedLookup('not a proof'), 'vlad@thelemail.test'))).toBe(
			'tlog_proof_malformed'
		);
	});

	it('monitor records the same failure and lets the lookup through', async () => {
		h.policy.value = { ...PINNED, mode: 'monitor' };
		const res = await verifyDirectoryLookup(await signedLookup(), 'vlad@thelemail.test');
		expect(res.statement.address).toBe('vlad@thelemail.test');
		expect(res.tlog).toMatchObject({ state: 'failed', code: 'tlog_proof_missing' });
		expect(h.seen.has('vlad@thelemail.test')).toBe(true);
	});

	it('no policy skips the log check', async () => {
		h.policy.value = null;
		const res = await verifyDirectoryLookup(await signedLookup(), 'vlad@thelemail.test');
		expect(res.tlog).toEqual({ state: 'not_configured' });
	});
});
