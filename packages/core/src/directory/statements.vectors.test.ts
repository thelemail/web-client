// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as openpgp from 'openpgp';

const h = vi.hoisted(() => ({
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
vi.mock('./tlog/policy', () => ({ TLOG_POLICY: null }));
vi.mock('./tlog/state-idb', () => ({ tlogStateStore: {} }));
vi.mock('$core/api/accounts', () => ({ lookupAccount: vi.fn() }));

import vectors from '../interop/vectors/statements.json';
import { verifyDirectoryLookup } from './verify';
import { DirectoryVerificationError } from './errors';
import { verifyDelegation, canonicaliseDelegation, parseDelegationStatement, delegationCoversSignatureAt } from './delegation';
import { verifyReadDelegate, canonicaliseReadDelegation, parseReadDelegationStatement } from './read-delegation';
import { canonicaliseAuthorization } from '$core/keys/forwardingKey';

const CODES: Record<string, string> = {
	statementMalformed: 'statement_malformed',
	signingKeyMismatch: 'signing_key_mismatch',
	algorithmMismatch: 'algorithm_mismatch',
	addressMismatch: 'address_mismatch',
	fingerprintMismatch: 'fingerprint_mismatch',
	signatureInvalid: 'signature_invalid',
	notSignOnly: 'not_sign_only',
	delegationMismatch: 'delegation_mismatch',
	revoked: 'revoked',
	permissionMismatch: 'permission_mismatch',
	notEncryptionOnly: 'not_encryption_only',
	notYetValid: 'not_yet_valid'
};

const TIME_BOUND = new Set(['notYetValid', 'expired', 'revoked']);

function bytes(b64: string): Uint8Array {
	return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function codeOf(p: Promise<unknown>): Promise<string> {
	try {
		await p;
		return 'ok';
	} catch (e) {
		return (e as { code?: string }).code ?? String(e);
	}
}

beforeEach(() => h.seen.clear());

const byKind = (kind: string) => vectors.cases.filter((c) => c.kind === kind);

describe('directory statements agree with trust', () => {
	for (const c of byKind('directory')) {
		it(`${c.name} -> ${c.expect}`, async () => {
			const run = verifyDirectoryLookup(
				{ publicKeyArmored: c.publicKeyArmored, directoryStatementRaw: c.raw, directorySignature: c.signature },
				c.address!
			);
			if (c.expect === 'ok') {
				const res = await run;
				expect(res.statement.address).toBe(c.address);
				return;
			}
			const err = await run.then(
				() => null,
				(e: unknown) => e
			);
			expect(err).toBeInstanceOf(DirectoryVerificationError);
			expect((err as DirectoryVerificationError).code).toBe(CODES[c.expect]);
			if (c.detail) {
				expect((err as DirectoryVerificationError).details.statementError).toBe(c.detail);
			}
		});
	}
});

describe('signing delegations agree with trust', () => {
	for (const c of byKind('delegation')) {
		it(`${c.name} -> ${c.expect}`, async () => {
			const run = verifyDelegation(
				{ id: c.id!, address: c.address!, publicKeyArmored: c.publicKeyArmored, statement: c.raw, statementSignature: c.signature },
				c.address!
			);
			if (c.expect === 'ok' || TIME_BOUND.has(c.expect) || c.expect === 'stale') {
				const statement = await run;
				expect(canonicaliseDelegation(parseDelegationStatement(bytes(c.raw)))).toEqual(bytes(c.raw));
				expect(delegationCoversSignatureAt(statement, new Date(c.at!))).toBe(!TIME_BOUND.has(c.expect));
				if (c.expect === 'stale') expect(statement.version).toBeLessThan(c.minVersion!);
				return;
			}
			expect(await codeOf(run)).toBe(CODES[c.expect]);
		});
	}
});

describe('read delegations agree with trust', () => {
	for (const c of byKind('readDelegation')) {
		it(`${c.name} -> ${c.expect}`, async () => {
			const run = verifyReadDelegate(
				{ id: c.id!, publicKeyArmored: c.publicKeyArmored, statement: c.raw, statementSignature: c.signature },
				c.address!,
				{ tlogPolicy: null, nowMillis: Date.parse(c.at!) }
			);
			if (c.expect === 'ok' || c.expect === 'stale') {
				const statement = await run;
				expect(canonicaliseReadDelegation(parseReadDelegationStatement(bytes(c.raw)))).toEqual(bytes(c.raw));
				if (c.expect === 'stale') expect(statement.version).toBeLessThan(c.minVersion!);
				return;
			}
			expect(await codeOf(run)).toBe(CODES[c.expect]);
		});
	}
});

describe('read authorisations agree with trust', () => {
	for (const c of byKind('readAuthorization')) {
		it(`${c.name} -> ${c.expect}`, async () => {
			const raw = bytes(c.raw);
			const owner = await openpgp.readKey({ armoredKey: c.publicKeyArmored });
			const result = await openpgp.verify({
				message: await openpgp.createMessage({ binary: raw }),
				signature: await openpgp.readSignature({ binarySignature: bytes(c.signature) }),
				verificationKeys: owner
			});
			const verified = await result.signatures[0].verified.then(
				() => true,
				() => false
			);
			expect(verified).toBe(c.expect === 'ok');
			if (c.expect !== 'ok') return;
			const s = c.statement as {
				accountId: string;
				address: string;
				destination: string;
				encryptionKeyFingerprint: string;
				issuedAt: string;
				permissions: string[];
				signerKeyFingerprint: string;
			};
			const canonical = canonicaliseAuthorization({
				accountId: s.accountId,
				address: s.address,
				destination: s.destination,
				encryptionKeyFingerprint: s.encryptionKeyFingerprint,
				issuedAt: s.issuedAt,
				signerKeyFingerprint: s.signerKeyFingerprint,
				permission: s.permissions[0] as 'decrypt-forwarded' | 'forward-plaintext'
			});
			expect(canonical).toEqual(raw);
		});
	}
});
