// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ serverNow: 0 }));

vi.mock('./signing-key', async () => {
	const openpgp = await import('openpgp');
	const { default: vectors } = await import('../interop/vectors/statements.json');
	const key = await openpgp.readKey({ armoredKey: vectors.directorySigningKey });
	return {
		DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED: vectors.directorySigningKey,
		DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: key.getFingerprint()
	};
});
vi.mock('./tlog/policy', () => ({ TLOG_POLICY: null }));
vi.mock('./tlog/state-idb', () => ({ tlogStateStore: {} }));
vi.mock('$core/api/accounts', () => ({ lookupAccount: vi.fn() }));
vi.mock('$core/api/serverclock', () => ({ serverNow: () => h.serverNow }));

import vectors from '../interop/vectors/statements.json';
import { verifyReadDelegate } from './read-delegation';

const revoked = vectors.cases.find((c) => c.kind === 'readDelegation' && c.name === 'revoked')!;
const delegate = { id: revoked.id!, publicKeyArmored: revoked.publicKeyArmored, statement: revoked.raw, statementSignature: revoked.signature };
const revokedAt = Date.parse(revoked.at!);

describe('read delegation clock', () => {
	it('keeps a revocation in force when the server clock claims an earlier time', async () => {
		h.serverNow = revokedAt - 24 * 60 * 60 * 1000;
		const err = await verifyReadDelegate(delegate, revoked.address!, { tlogPolicy: null }).then(
			() => null,
			(e: unknown) => e as { code?: string }
		);
		expect(err?.code).toBe('revoked');
	});

});
