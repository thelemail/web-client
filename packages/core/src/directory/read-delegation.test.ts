// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as openpgp from 'openpgp';

const h = vi.hoisted(() => ({ signerArmored: '', signerFingerprint: '' }));

vi.mock('./signing-key', () => ({
	get DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED() {
		return h.signerArmored;
	},
	get DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX() {
		return h.signerFingerprint;
	}
}));
vi.mock('./tlog/policy', () => ({ TLOG_POLICY: null }));
vi.mock('./tlog/state-idb', () => ({ tlogStateStore: {} }));
vi.mock('$core/api/accounts', () => ({ lookupAccount: vi.fn() }));

import type { ReadDelegate } from '$core/api/types';
import { generateForwardingKey } from '$core/keys/forwardingKey';
import {
	canonicaliseReadDelegation,
	parseReadDelegationStatement,
	ReadDelegationVerificationError,
	verifyReadDelegate,
	type ReadDelegationStatement
} from './read-delegation';

const GO_CANONICAL =
	'{"accountId":"11111111-2222-3333-4444-555555555555",' +
	'"address":"contact@example.com",' +
	`"encryptionKeyFingerprint":"${'ab'.repeat(32)}",` +
	'"issuedAt":"2026-09-17T12:00:00Z",' +
	'"keyAlgorithm":"openpgp-ed25519",' +
	'"notBefore":"2026-09-17T12:00:00Z",' +
	'"permissions":["decrypt-forwarded"],' +
	'"readDelegationId":"66666666-7777-8888-9999-aaaaaaaaaaaa",' +
	'"revokedAt":null,' +
	`"signingKeyFingerprint":"${'ef'.repeat(32)}",` +
	'"version":1}';

let signer: openpgp.PrivateKey;

beforeAll(async () => {
	const generated = await openpgp.generateKey({
		type: 'curve25519',
		userIDs: [{ email: 'directory@thelemail.test' }],
		format: 'object'
	});
	signer = generated.privateKey;
	h.signerArmored = generated.publicKey.armor();
	h.signerFingerprint = generated.publicKey.getFingerprint().toLowerCase();
});

function b64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

async function delegate(
	address: string,
	mutate: (s: ReadDelegationStatement) => void = () => {},
	keyEmail = address
): Promise<ReadDelegate> {
	const key = await generateForwardingKey(keyEmail);
	const statement: ReadDelegationStatement = {
		accountId: '11111111-2222-3333-4444-555555555555',
		address,
		encryptionKeyFingerprint: key.keyFingerprintHex,
		issuedAt: '2026-09-17T12:00:00Z',
		keyAlgorithm: 'openpgp-eddsa',
		notBefore: '2026-09-17T12:00:00Z',
		permissions: ['decrypt-forwarded'],
		readDelegationId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
		revokedAt: null,
		signingKeyFingerprint: h.signerFingerprint,
		version: 1
	};
	mutate(statement);
	const canonical = canonicaliseReadDelegation(statement);
	const signature = await openpgp.sign({
		message: await openpgp.createMessage({ binary: canonical }),
		signingKeys: signer,
		detached: true,
		format: 'binary'
	});
	const jsonb = JSON.stringify(JSON.parse(new TextDecoder().decode(canonical)), null, 1);
	return {
		id: statement.readDelegationId,
		publicKeyArmored: key.publicKeyArmored,
		statement: b64(new TextEncoder().encode(jsonb)),
		statementSignature: b64(signature as Uint8Array)
	};
}

async function expectCode(p: Promise<unknown>, code: string) {
	await expect(p).rejects.toBeInstanceOf(ReadDelegationVerificationError);
	await p.catch((e: ReadDelegationVerificationError) => expect(e.code).toBe(code));
}

describe('read delegation statement', () => {
	it('matches the Go canonicaliser byte for byte', () => {
		const parsed = parseReadDelegationStatement(new TextEncoder().encode(GO_CANONICAL));
		expect(new TextDecoder().decode(canonicaliseReadDelegation(parsed))).toBe(GO_CANONICAL);
	});
});

describe('verifyReadDelegate', () => {
	it('accepts a signed, encryption-only delegate for the address', async () => {
		const d = await delegate('contact@example.com');
		const statement = await verifyReadDelegate(d, 'Contact@Example.com');
		expect(statement.readDelegationId).toBe(d.id);
	});

	it('rejects a delegate for another address', async () => {
		await expectCode(verifyReadDelegate(await delegate('sales@example.com'), 'contact@example.com'), 'address_mismatch');
	});

	it('rejects a key bound to another address', async () => {
		await expectCode(
			verifyReadDelegate(await delegate('contact@example.com', () => {}, 'sales@example.com'), 'contact@example.com'),
			'address_mismatch'
		);
	});

	it('rejects a revoked statement', async () => {
		const d = await delegate('contact@example.com', (s) => {
			s.revokedAt = '2026-09-18T00:00:00Z';
			s.version = 2;
		});
		await expectCode(verifyReadDelegate(d, 'contact@example.com'), 'revoked');
	});

	it('rejects extra permissions', async () => {
		const d = await delegate('contact@example.com', (s) => {
			s.permissions = ['decrypt-forwarded', 'sign'];
		});
		await expectCode(verifyReadDelegate(d, 'contact@example.com'), 'permission_mismatch');
	});

	it('rejects a swapped key', async () => {
		const d = await delegate('contact@example.com');
		d.publicKeyArmored = (await generateForwardingKey('contact@example.com')).publicKeyArmored;
		await expectCode(verifyReadDelegate(d, 'contact@example.com'), 'fingerprint_mismatch');
	});

	it('rejects a statement the directory did not sign', async () => {
		const d = await delegate('contact@example.com');
		const tampered = JSON.parse(atob(d.statement));
		tampered.notBefore = '2026-01-01T00:00:00Z';
		d.statement = btoa(JSON.stringify(tampered));
		await expectCode(verifyReadDelegate(d, 'contact@example.com'), 'signature_invalid');
	});

	it('rejects an id that does not match the statement', async () => {
		const d = await delegate('contact@example.com');
		d.id = '00000000-0000-0000-0000-000000000000';
		await expectCode(verifyReadDelegate(d, 'contact@example.com'), 'delegation_mismatch');
	});
});
