// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
	failure: 'tlog_checkpoint_behind',
	seen: new Map<string, { address: string; version: number; keyFingerprint: string; firstSeenAt: number; lastSeenAt: number }>()
}));

vi.mock('./signing-key', async () => {
	const openpgp = await import('openpgp');
	const { default: vectors } = await import('../interop/vectors/statements.json');
	const key = await openpgp.readKey({ armoredKey: vectors.directorySigningKey });
	return {
		DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED: vectors.directorySigningKey,
		DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: key.getFingerprint()
	};
});
vi.mock('./seen-idb', () => ({
	getSeen: async (address: string) => h.seen.get(address) ?? null,
	upsertSeen: async (record: { address: string; version: number; keyFingerprint: string; firstSeenAt: number; lastSeenAt: number }) => {
		h.seen.set(record.address, record);
	}
}));
vi.mock('./tlog/policy', () => ({
	TLOG_POLICY: {
		mode: 'enforce',
		origin: 'log.thelemail.test/keys',
		logVerifierKey: 'log.thelemail.test/keys+00000000+AQ==',
		vrfPublicKey: 'AA==',
		witnessVerifierKeys: [],
		witnessThreshold: 0,
		maxCosignatureAgeSeconds: 86400
	}
}));
vi.mock('./tlog/state-idb', () => ({ tlogStateStore: {} }));
vi.mock('$core/api/accounts', () => ({ lookupAccount: vi.fn() }));
vi.mock('./tlog/verify-tlog', async () => {
	const { DirectoryVerificationError } = await import('./errors');
	return {
		verifyTlogProof: async () => {
			throw new DirectoryVerificationError(h.failure as 'tlog_checkpoint_behind', 'tlog check failed', {});
		}
	};
});

import vectors from '../interop/vectors/statements.json';
import { verifyDirectoryLookup } from './verify';
import { DirectoryVerificationError } from './errors';

const ok = vectors.cases.find((c) => c.kind === 'directory' && c.name === 'ok')!;
const lookup = { publicKeyArmored: ok.publicKeyArmored, directoryStatementRaw: ok.raw, directorySignature: ok.signature, tlogProof: 'proof' };

beforeEach(() => h.seen.clear());

describe('an enforcing log policy', () => {
	it('records an older consistent checkpoint without refusing the lookup', async () => {
		h.failure = 'tlog_checkpoint_behind';
		const res = await verifyDirectoryLookup(lookup, ok.address!);
		expect(res.tlog).toMatchObject({ state: 'failed', code: 'tlog_checkpoint_behind' });
	});

	it('still refuses a stale checkpoint', async () => {
		h.failure = 'tlog_checkpoint_stale';
		const err = await verifyDirectoryLookup(lookup, ok.address!).then(
			() => null,
			(e: unknown) => e
		);
		expect(err).toBeInstanceOf(DirectoryVerificationError);
		expect((err as DirectoryVerificationError).code).toBe('tlog_checkpoint_stale');
	});
});
