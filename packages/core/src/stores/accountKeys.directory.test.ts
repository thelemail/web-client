// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';
import type { TlogRuntimePolicy } from '$core/directory/tlog/policy';
import type { LookupInputForVerification } from '$core/directory/verify';

const h = vi.hoisted(() => ({
	signerArmored: '',
	signerFingerprint: '',
	policy: { value: null as unknown },
	tlogFailure: { value: null as Error | null },
	seen: new Map<string, { address: string; version: number; keyFingerprint: string }>(),
	lookup: { value: null as unknown },
	current: { value: '' },
	status: { value: [] as unknown[] }
}));

vi.mock('$app/env', () => ({ browser: true }));
vi.mock('$core/products', () => ({ isProductVault: false }));
vi.mock('$core/api/me', () => ({ listMyKeys: async () => ({ currentVersion: 1, keys: [] }) }));
vi.mock('$core/api/accounts', () => ({ lookupAccount: vi.fn() }));
vi.mock('$core/directory/signing-key', () => ({
	get DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED() {
		return h.signerArmored;
	},
	get DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX() {
		return h.signerFingerprint;
	}
}));
vi.mock('$core/directory/seen-idb', () => ({
	getSeen: async (address: string) => h.seen.get(address) ?? null,
	upsertSeen: async (record: { address: string; version: number; keyFingerprint: string }) => {
		h.seen.set(record.address, record);
	}
}));
vi.mock('$core/directory/tlog/policy', () => ({
	get TLOG_POLICY() {
		return h.policy.value;
	}
}));
vi.mock('$core/directory/tlog/state-idb', () => ({ tlogStateStore: {} }));
vi.mock('$core/directory/tlog/verify-tlog', () => ({
	verifyTlogProof: async () => {
		if (h.tlogFailure.value) throw h.tlogFailure.value;
		return { origin: 'thelemail.com/keys', treeSize: 10, leafIndex: 9, validWitnessCount: 2, witnessThreshold: 2 };
	}
}));
vi.mock('$core/directory/lookup', () => ({ lookupDirectory: async () => h.lookup.value }));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribe: () => () => undefined,
		status: async () => ({ accounts: h.status.value }),
		loadAccountKeys: async () => ({ ok: true, loaded: [], failed: [], unverified: [] }),
		getPublicKey: async () => ({
			ok: true,
			fingerprint: Uint8Array.from(h.current.value.match(/../g)!.map((b) => parseInt(b, 16))),
			keyVersion: 1,
			publicKeyArmored: 'public'
		}),
		listAccountKeys: async () => ({ ok: true, keyVersion: 1, keys: [] })
	}
}));

import { accountKeys } from './accountKeys.svelte';
import { DirectoryVerificationError } from '$core/directory/errors';
import { signStatement, type StatementFields } from '$core/directory/fixtures/signedStatement';
import { rotationVectors, vectorKey } from '$core/directory/fixtures/rotation';

const rotated = rotationVectors.statements.find((s) => s.name === 'transitions-three-mixed')!.expected!;
const ADDRESS = rotated.address;
const ACCOUNT = rotated.accountId;
const CURRENT = vectorKey(rotated.keyFingerprint);
const RETIRED = vectorKey(rotated.keyTransitions![0].previousKeyFingerprint);

const POLICY: TlogRuntimePolicy = {
	origin: 'thelemail.com/keys',
	logVerifierKey: 'thelemail.com/keys+76ead63c+ASduViYkPgYHzuTuDnuTdEkjR/DIprnavuFA3vom4YZT',
	vrfPublicKey: 'AFye6B/Tm9oZVs25OmoSyDWn16PFdnIhG2vpOJGSzEE=',
	witnessVerifierKeys: [],
	witnessThreshold: 0,
	maxCosignatureAgeSeconds: 86400,
	mode: 'enforce'
};

let signer: openpgp.PrivateKey;

async function serve(
	key: { fingerprint: string; publicKeyArmored: string },
	fields: Partial<StatementFields> = {}
): Promise<void> {
	const signed = await signStatement(signer, {
		accountId: ACCOUNT,
		address: ADDRESS,
		issuedAt: rotated.issuedAt,
		keyAlgorithm: rotated.keyAlgorithm,
		keyFingerprint: key.fingerprint,
		signingKeyFingerprint: h.signerFingerprint,
		version: rotated.version,
		...fields
	});
	h.lookup.value = {
		publicKeyArmored: key.publicKeyArmored,
		...signed,
		tlogProof: 'proof'
	} satisfies LookupInputForVerification;
}

beforeAll(async () => {
	const s = await openpgp.generateKey({
		type: 'curve25519',
		userIDs: [{ email: 'directory@thelemail.test' }],
		format: 'object'
	});
	signer = s.privateKey;
	h.signerArmored = s.publicKey.armor();
	h.signerFingerprint = s.publicKey.getFingerprint().toLowerCase();
}, 60_000);

beforeEach(() => {
	h.seen.clear();
	h.policy.value = { ...POLICY };
	h.tlogFailure.value = null;
	h.status.value = [{ accountId: ACCOUNT, email: ADDRESS, unlocked: true, authScheme: 'opaque_v1' }];
	accountKeys.setAccount(null);
	accountKeys.setAccount(ACCOUNT);
});

describe('own directory check against signed statements', () => {
	it('blocks a statement for another key even when its log proof was stripped', async () => {
		h.current.value = RETIRED.fingerprint;
		await serve(CURRENT, { keyTransitions: rotated.keyTransitions });
		h.tlogFailure.value = new DirectoryVerificationError('tlog_proof_missing', 'no proof');
		await accountKeys.load(ACCOUNT);
		expect(accountKeys.verification).toBe('unverified');
		expect(await accountKeys.confirm(ACCOUNT)).toBe('unverified');
	});

	it('blocks an older statement for a retired key once a newer one was seen, across a sign-out', async () => {
		h.current.value = CURRENT.fingerprint;
		await serve(CURRENT, { keyTransitions: rotated.keyTransitions, version: rotated.version + 1 });
		await accountKeys.load(ACCOUNT);
		expect(accountKeys.verification).toBe('verified');

		await serve(RETIRED, { version: rotated.version });
		h.current.value = RETIRED.fingerprint;
		accountKeys.setAccount(null);
		accountKeys.setAccount(ACCOUNT);
		await accountKeys.load(ACCOUNT);
		expect(accountKeys.verification).toBe('unverified');
		expect(await accountKeys.confirm(ACCOUNT)).toBe('unverified');
	});

	it('accepts the matching statement for the current key', async () => {
		h.current.value = CURRENT.fingerprint;
		await serve(CURRENT, { keyTransitions: rotated.keyTransitions });
		expect(await accountKeys.confirm(ACCOUNT)).toBeNull();
		expect(accountKeys.verification).toBe('verified');
	});
});
