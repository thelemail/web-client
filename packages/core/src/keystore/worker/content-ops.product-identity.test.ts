// @vitest-environment node
import * as openpgp from 'openpgp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { VaultState } from './state';

vi.mock('@protontech/crypto', () => ({ CryptoProxy: { setEndpoint() {} } }));
vi.mock('@protontech/crypto/proxy/endpoint/api.ts', () => ({
	Api: class {
		static init() {}
	}
}));
vi.mock('@protontech/crypto/srp', () => ({}));

const { handleDecrypt } = await import('./content-ops');
const { vaults } = await import('./state');

const accountId = '5b6f1c34-7d0e-4c3a-9f61-2a1d3b6c8e90';
let mine: openpgp.PrivateKey;
let sender: openpgp.PrivateKey;
let calendarIdentity: openpgp.PrivateKey;

async function sealedBy(signer: openpgp.PrivateKey): Promise<Uint8Array> {
	return (await openpgp.encrypt({
		message: await openpgp.createMessage({ text: 'hello' }),
		encryptionKeys: mine.toPublic(),
		signingKeys: signer,
		format: 'binary'
	})) as Uint8Array;
}

beforeAll(async () => {
	mine = (await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'ada@thelemail.test' }], format: 'object', config: { v6Keys: true } })).privateKey;
	sender = (await openpgp.generateKey({ type: 'curve25519', userIDs: [{ email: 'bruno@thelemail.test' }], format: 'object', config: { v6Keys: true } })).privateKey;
	calendarIdentity = (await openpgp.generateKey({ type: 'curve25519', userIDs: [], format: 'object', config: { v6Keys: true } })).privateKey;
	const v: VaultState = {
		accountId,
		email: 'ada@thelemail.test',
		authScheme: 'opaque_v1',
		armoredEncryptedPrivateKey: '',
		privateKey: mine,
		keyPassword: '',
		accountKeys: new Map(),
		keyVersion: 1,
		aliasKeys: new Map(),
		aliasCurrent: new Map()
	};
	vaults.set(accountId, v);
});

describe('mail signature verification', () => {
	it('accepts a mail key signature', async () => {
		const res = await handleDecrypt({ accountId, ciphertextBinary: await sealedBy(sender), verificationKeysArmored: [sender.toPublic().armor()] });
		expect(res.ok && res.signature?.state).toBe('valid');
	});

	it('never accepts a calendar identity as a mail signer', async () => {
		const res = await handleDecrypt({
			accountId,
			ciphertextBinary: await sealedBy(calendarIdentity),
			verificationKeysArmored: [calendarIdentity.toPublic().armor()]
		});
		expect(res.ok).toBe(true);
		expect(res.ok && res.signature?.state).not.toBe('valid');
	});
});
