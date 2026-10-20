// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import * as openpgp from 'openpgp';
import { inspectArmoredKey } from './armor';

let publicArmored = '';
let privateArmored = '';
let fingerprintHex = '';

beforeAll(async () => {
	const k = await openpgp.generateKey({
		userIDs: [{ name: 'Ada', email: 'ada@example.org' }, { email: 'ada@work.example' }],
		format: 'object'
	});
	publicArmored = k.publicKey.armor();
	privateArmored = k.privateKey.armor();
	fingerprintHex = k.publicKey.getFingerprint().toLowerCase();
}, 60_000);

describe('inspectArmoredKey', () => {
	it('returns the fingerprint and user ids of a public key', async () => {
		const res = await inspectArmoredKey(`\n${publicArmored}\n`);
		expect(res?.fingerprintHex).toBe(fingerprintHex);
		expect(res?.userIds).toEqual(['Ada <ada@example.org>', '<ada@work.example>']);
	});

	it('returns null for malformed armor', async () => {
		expect(await inspectArmoredKey('')).toBeNull();
		expect(await inspectArmoredKey('-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nnope\n-----END PGP PUBLIC KEY BLOCK-----')).toBeNull();
		expect(await inspectArmoredKey(publicArmored.slice(0, publicArmored.length / 2))).toBeNull();
	});

	it('refuses a private key', async () => {
		expect(await inspectArmoredKey(privateArmored)).toBeNull();
	});
});
