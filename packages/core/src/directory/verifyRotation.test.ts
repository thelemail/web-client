// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as openpgp from 'openpgp';
import type { TlogRuntimePolicy } from './tlog/policy';

type Seen = {
	address: string;
	version: number;
	keyFingerprint: string;
	accountId?: string;
	firstSeenAt: number;
	lastSeenAt: number;
};

const h = vi.hoisted(() => ({
	signerArmored: '',
	signerFingerprint: '',
	policy: { value: null as TlogRuntimePolicy | null },
	tlogFailure: { value: null as Error | null },
	seen: new Map<string, Seen>()
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
	upsertSeen: async (record: Seen) => {
		h.seen.set(record.address, record);
	}
}));
vi.mock('./tlog/policy', () => ({
	get TLOG_POLICY() {
		return h.policy.value;
	}
}));
vi.mock('./tlog/state-idb', () => ({ tlogStateStore: {} }));
vi.mock('./tlog/verify-tlog', () => ({
	verifyTlogProof: async () => {
		if (h.tlogFailure.value) throw h.tlogFailure.value;
		return {
			origin: 'thelemail.com/keys',
			treeSize: 10,
			leafIndex: 9,
			validWitnessCount: 2,
			witnessThreshold: 2
		};
	}
}));
vi.mock('$core/api/accounts', () => ({ lookupAccount: vi.fn() }));

import { verifyDirectoryLookup, type LookupInputForVerification } from './verify';
import { DirectoryVerificationError } from './errors';
import { signStatement, type StatementFields } from './fixtures/signedStatement';
import { the168, vectorKey } from './fixtures/the168';

const POLICY: TlogRuntimePolicy = {
	origin: 'thelemail.com/keys',
	logVerifierKey: 'thelemail.com/keys+76ead63c+ASduViYkPgYHzuTuDnuTdEkjR/DIprnavuFA3vom4YZT',
	vrfPublicKey: 'AFye6B/Tm9oZVs25OmoSyDWn16PFdnIhG2vpOJGSzEE=',
	witnessVerifierKeys: [],
	witnessThreshold: 0,
	maxCosignatureAgeSeconds: 86400,
	mode: 'monitor'
};

const rotated = the168.statements.find((s) => s.name === 'transitions-three-mixed')!.expected!;
const ADDRESS = rotated.address;
const ACCOUNT = rotated.accountId;
const CURRENT = vectorKey(rotated.keyFingerprint);
const V6_B = vectorKey(rotated.keyTransitions![0].previousKeyFingerprint);
const V4 = vectorKey(rotated.keyTransitions![2].previousKeyFingerprint);
const UNRELATED = the168.keys.find((k) => k.name === 'unrelated')!;

let signer: openpgp.PrivateKey;

function statement(overrides: Partial<StatementFields> = {}): StatementFields {
	return {
		accountId: ACCOUNT,
		address: ADDRESS,
		issuedAt: rotated.issuedAt,
		keyAlgorithm: rotated.keyAlgorithm,
		keyFingerprint: CURRENT.fingerprint,
		keyTransitions: rotated.keyTransitions,
		signingKeyFingerprint: h.signerFingerprint,
		version: rotated.version,
		...overrides
	};
}

async function lookup(
	fields: StatementFields,
	previousKey?: { fingerprint: string; publicKeyArmored: string }
): Promise<LookupInputForVerification> {
	return {
		publicKeyArmored: CURRENT.publicKeyArmored,
		...(await signStatement(signer, fields)),
		tlogProof: 'proof',
		previousKey
	};
}

function pin(fingerprint: string, version: number, accountId?: string) {
	h.seen.set(ADDRESS, {
		address: ADDRESS,
		version,
		keyFingerprint: fingerprint,
		accountId,
		firstSeenAt: 1,
		lastSeenAt: 2
	});
}

async function failure(p: Promise<unknown>): Promise<DirectoryVerificationError> {
	const err = await p.then(
		() => null,
		(e: unknown) => e
	);
	expect(err).toBeInstanceOf(DirectoryVerificationError);
	return err as DirectoryVerificationError;
}

function served(key: { fingerprint: string; publicKeyArmored: string }) {
	return { fingerprint: key.fingerprint, publicKeyArmored: key.publicKeyArmored };
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
});

describe('signed key rotation', () => {
	it('moves a pin silently when the pinned key endorsed the new one', async () => {
		pin(V6_B.fingerprint, 6, ACCOUNT);
		const res = await verifyDirectoryLookup(await lookup(statement(), served(V6_B)), ADDRESS);
		expect(res.transition).toEqual({
			previousFingerprint: V6_B.fingerprint,
			retiredAt: rotated.keyTransitions![0].retiredAt,
			retiredAtMillis: Date.parse(rotated.keyTransitions![0].retiredAt)
		});
		expect(h.seen.get(ADDRESS)).toMatchObject({
			keyFingerprint: CURRENT.fingerprint,
			version: rotated.version,
			accountId: ACCOUNT
		});
	});

	it('accepts a pin several rotations back in one hop, including a v4 key', async () => {
		pin(V4.fingerprint, 1);
		const res = await verifyDirectoryLookup(await lookup(statement(), served(V4)), ADDRESS);
		expect(res.transition?.previousFingerprint).toBe(V4.fingerprint);
	});

	it('prompts when the pinned key never endorsed the new one', async () => {
		pin(UNRELATED.fingerprint, 6);
		const err = await failure(verifyDirectoryLookup(await lookup(statement(), served(UNRELATED)), ADDRESS));
		expect(err.code).toBe('fingerprint_changed');
		expect(err.details.transition).toBe('absent');
		expect(h.seen.get(ADDRESS)?.keyFingerprint).toBe(UNRELATED.fingerprint);
	});

	it('prompts when the statement carries no endorsements at all', async () => {
		pin(V6_B.fingerprint, 6);
		const fields = statement({ keyTransitions: undefined });
		const err = await failure(verifyDirectoryLookup(await lookup(fields, served(V6_B)), ADDRESS));
		expect(err.code).toBe('fingerprint_changed');
		expect(err.details.transition).toBe('absent');
	});

	it('prompts when the previous key is not served', async () => {
		pin(V6_B.fingerprint, 6);
		const err = await failure(verifyDirectoryLookup(await lookup(statement()), ADDRESS));
		expect(err.code).toBe('fingerprint_changed');
		expect(err.details.transition).toBe('previous_key_unavailable');
	});

	it('prompts when the served previous key is another key', async () => {
		pin(V6_B.fingerprint, 6);
		const swapped = { fingerprint: V6_B.fingerprint, publicKeyArmored: UNRELATED.publicKeyArmored };
		const err = await failure(verifyDirectoryLookup(await lookup(statement(), swapped), ADDRESS));
		expect(err.details.transition).toBe('previous_key_unavailable');
	});

	it('prompts when the address now belongs to another account', async () => {
		pin(V6_B.fingerprint, 6, '00000000-0000-4000-8000-000000000000');
		const err = await failure(verifyDirectoryLookup(await lookup(statement(), served(V6_B)), ADDRESS));
		expect(err.code).toBe('fingerprint_changed');
		expect(err.details.transition).toBe('account_changed');
	});

	it('blocks a tampered endorsement inside a signed statement', async () => {
		pin(V6_B.fingerprint, 6);
		const transitions = rotated.keyTransitions!.map((t, i) => {
			if (i !== 0) return t;
			const bytes = Uint8Array.from(atob(t.signature), (c) => c.charCodeAt(0));
			bytes[bytes.length - 1] ^= 0x01;
			return { ...t, signature: btoa(String.fromCharCode(...bytes)) };
		});
		const err = await failure(
			verifyDirectoryLookup(await lookup(statement({ keyTransitions: transitions }), served(V6_B)), ADDRESS)
		);
		expect(err.code).toBe('key_transition_invalid');
		expect(h.seen.get(ADDRESS)?.keyFingerprint).toBe(V6_B.fingerprint);
	});

	it('blocks an endorsement replayed into another account', async () => {
		pin(V6_B.fingerprint, 6);
		const fields = statement({ accountId: '00000000-0000-4000-8000-000000000000' });
		const err = await failure(verifyDirectoryLookup(await lookup(fields, served(V6_B)), ADDRESS));
		expect(err.code).toBe('key_transition_invalid');
		expect(err.details.transitionError).toBe('signature');
	});

	it('treats the same version with another key as a rollback', async () => {
		pin(V6_B.fingerprint, rotated.version);
		const err = await failure(verifyDirectoryLookup(await lookup(statement(), served(V6_B)), ADDRESS));
		expect(err.code).toBe('version_rolled_back');
	});

	it('waits for the log instead of prompting when the entry has no proof yet', async () => {
		pin(V6_B.fingerprint, 6);
		h.tlogFailure.value = new DirectoryVerificationError('tlog_proof_missing', 'no proof');
		const err = await failure(verifyDirectoryLookup(await lookup(statement(), served(V6_B)), ADDRESS));
		expect(err.code).toBe('tlog_pending');
		expect(err.details.tlogCode).toBe('tlog_proof_missing');
		expect(h.seen.get(ADDRESS)?.keyFingerprint).toBe(V6_B.fingerprint);
	});

	it('waits for the log in enforce mode too', async () => {
		pin(V6_B.fingerprint, 6);
		h.policy.value = { ...POLICY, mode: 'enforce' };
		h.tlogFailure.value = new DirectoryVerificationError('tlog_proof_missing', 'no proof');
		const err = await failure(verifyDirectoryLookup(await lookup(statement(), served(V6_B)), ADDRESS));
		expect(err.code).toBe('tlog_pending');
	});

	it('prompts instead of moving a pin without a log policy', async () => {
		pin(V6_B.fingerprint, 6);
		h.policy.value = null;
		const err = await failure(verifyDirectoryLookup(await lookup(statement(), served(V6_B)), ADDRESS));
		expect(err.code).toBe('fingerprint_changed');
		expect(err.details.transition).toBe('log_unverified');
		expect(err.details.tlogCode).toBeUndefined();
		expect(h.seen.get(ADDRESS)?.keyFingerprint).toBe(V6_B.fingerprint);
	});

	it('prompts on a broken log proof in monitor mode', async () => {
		pin(V6_B.fingerprint, 6);
		h.tlogFailure.value = new DirectoryVerificationError('tlog_inclusion_invalid', 'bad path');
		const err = await failure(verifyDirectoryLookup(await lookup(statement(), served(V6_B)), ADDRESS));
		expect(err.code).toBe('fingerprint_changed');
		expect(err.details.transition).toBe('log_unverified');
		expect(err.details.tlogCode).toBe('tlog_inclusion_invalid');
		expect(h.seen.get(ADDRESS)?.keyFingerprint).toBe(V6_B.fingerprint);
	});

	it('fails on a broken log proof in enforce mode', async () => {
		pin(V6_B.fingerprint, 6);
		h.policy.value = { ...POLICY, mode: 'enforce' };
		h.tlogFailure.value = new DirectoryVerificationError('tlog_inclusion_invalid', 'bad path');
		const err = await failure(verifyDirectoryLookup(await lookup(statement(), served(V6_B)), ADDRESS));
		expect(err.code).toBe('tlog_inclusion_invalid');
		expect(h.seen.get(ADDRESS)?.keyFingerprint).toBe(V6_B.fingerprint);
	});

	it('lets the user accept a change the log could not confirm', async () => {
		pin(V6_B.fingerprint, 6);
		h.tlogFailure.value = new DirectoryVerificationError('tlog_inclusion_invalid', 'bad path');
		const res = await verifyDirectoryLookup(await lookup(statement(), served(V6_B)), ADDRESS, {
			acceptFingerprint: CURRENT.fingerprint
		});
		expect(res.transition).toBeUndefined();
		expect(h.seen.get(ADDRESS)?.keyFingerprint).toBe(CURRENT.fingerprint);
	});

	it('accepts only the exact fingerprint the user confirmed', async () => {
		pin(UNRELATED.fingerprint, 6);
		const other = await failure(
			verifyDirectoryLookup(await lookup(statement()), ADDRESS, { acceptFingerprint: V4.fingerprint })
		);
		expect(other.code).toBe('fingerprint_changed');
		const res = await verifyDirectoryLookup(await lookup(statement()), ADDRESS, {
			acceptFingerprint: CURRENT.fingerprint.toUpperCase()
		});
		expect(res.transition).toBeUndefined();
		expect(h.seen.get(ADDRESS)?.keyFingerprint).toBe(CURRENT.fingerprint);
	});

	it('still rejects a rollback the user tries to accept', async () => {
		pin(V6_B.fingerprint, 9);
		const err = await failure(
			verifyDirectoryLookup(await lookup(statement()), ADDRESS, { acceptFingerprint: CURRENT.fingerprint })
		);
		expect(err.code).toBe('version_rolled_back');
	});

	it('records the account on first contact', async () => {
		await verifyDirectoryLookup(await lookup(statement()), ADDRESS);
		expect(h.seen.get(ADDRESS)?.accountId).toBe(ACCOUNT);
	});
});
