// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
	seen: new Map<string, { address: string; version: number; keyFingerprint: string; firstSeenAt: number; lastSeenAt: number }>()
}));

vi.mock('./signing-key', async () => {
	const { the168 } = await import('./fixtures/the168');
	return {
		DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED: the168.directorySigningKey.publicKeyArmored,
		DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: the168.directorySigningKey.fingerprint
	};
});
vi.mock('./seen-idb', () => ({
	getSeen: async (address: string) => h.seen.get(address) ?? null,
	upsertSeen: async (record: { address: string; version: number; keyFingerprint: string; firstSeenAt: number; lastSeenAt: number }) => {
		h.seen.set(record.address, record);
	}
}));
vi.mock('./tlog/policy', () => ({ TLOG_POLICY: null }));
vi.mock('./tlog/state-idb', () => ({ tlogStateStore: {} }));
vi.mock('$core/api/accounts', () => ({ lookupAccount: vi.fn() }));

import { verifyDirectoryLookup } from './verify';
import { DirectoryVerificationError } from './errors';
import { the168, vectorKey } from './fixtures/the168';

const FALLBACK_ADDRESS = 'nora@thelemail.test';

beforeEach(() => h.seen.clear());

describe('directory verification over the shared vectors', () => {
	for (const v of the168.statements.filter((s) => s.valid)) {
		it(`verifies ${v.name}`, async () => {
			const e = v.expected!;
			const res = await verifyDirectoryLookup(
				{
					publicKeyArmored: vectorKey(e.keyFingerprint).publicKeyArmored,
					directoryStatementRaw: v.raw,
					directorySignature: v.signature
				},
				e.address
			);
			expect(res.statement.accountId).toBe(e.accountId);
			expect(res.statement.keyFingerprint).toBe(e.keyFingerprint);
			expect(res.statement.version).toBe(e.version);
			expect(res.statement.keyTransitions.map((t) => t.previousKeyFingerprint)).toEqual(
				(e.keyTransitions ?? []).map((t) => t.previousKeyFingerprint)
			);
			expect(res.firstContact).toBe(true);
		});
	}

	for (const v of the168.statements.filter((s) => !s.valid)) {
		it(`refuses ${v.name} before trusting any field`, async () => {
			const err = await verifyDirectoryLookup(
				{
					publicKeyArmored: the168.keys[0].publicKeyArmored,
					directoryStatementRaw: v.raw,
					directorySignature: v.signature
				},
				FALLBACK_ADDRESS
			).then(
				() => null,
				(e: unknown) => e
			);
			expect(err).toBeInstanceOf(DirectoryVerificationError);
			expect((err as DirectoryVerificationError).code).toBe('statement_malformed');
			expect((err as DirectoryVerificationError).details.statementError).toBe(v.error);
			expect(h.seen.size).toBe(0);
		});
	}

	it('refuses a lookup without statement bytes', async () => {
		const v = the168.statements[0];
		const err = await verifyDirectoryLookup(
			{ publicKeyArmored: the168.keys[0].publicKeyArmored, directorySignature: v.signature },
			FALLBACK_ADDRESS
		).then(
			() => null,
			(e: unknown) => e
		);
		expect((err as DirectoryVerificationError).code).toBe('statement_malformed');
		expect((err as DirectoryVerificationError).details.statementError).toBe('missing');
	});

	it('rejects a signature made over other bytes', async () => {
		const [a, b] = the168.statements.filter((s) => s.valid);
		const err = await verifyDirectoryLookup(
			{
				publicKeyArmored: vectorKey(a.expected!.keyFingerprint).publicKeyArmored,
				directoryStatementRaw: a.raw,
				directorySignature: b.signature
			},
			a.expected!.address
		).then(
			() => null,
			(e: unknown) => e
		);
		expect((err as DirectoryVerificationError).code).toBe('signature_invalid');
	});

	it('rejects a served key the statement does not name', async () => {
		const v = the168.statements.find((s) => s.name === 'plain-v1')!;
		const other = the168.keys.find((k) => k.fingerprint !== v.expected!.keyFingerprint && k.keyVersion === 6)!;
		const err = await verifyDirectoryLookup(
			{
				publicKeyArmored: other.publicKeyArmored,
				directoryStatementRaw: v.raw,
				directorySignature: v.signature
			},
			v.expected!.address
		).then(
			() => null,
			(e: unknown) => e
		);
		expect((err as DirectoryVerificationError).code).toBe('fingerprint_mismatch');
	});
});
