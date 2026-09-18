// @vitest-environment node
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';

import {
	authorizationTimestamp,
	canonicaliseAuthorization,
	generateForwardingKey
} from './forwardingKey';

const GO_CANONICAL =
	'{"accountId":"11111111-2222-3333-4444-555555555555","address":"contact@example.com",' +
	'"destination":"support@helpdesk.example","encryptionKeyFingerprint":"' +
	'ab'.repeat(32) +
	'",' +
	'"issuedAt":"2026-09-17T12:00:00Z","permissions":["decrypt-forwarded"],' +
	'"signerKeyFingerprint":"' +
	'cd'.repeat(32) +
	'","type":"thelemail-read-delegation/v1"}';

describe('forwarding authorization', () => {
	it('matches the Go canonicaliser byte for byte', () => {
		const bytes = canonicaliseAuthorization({
			accountId: '11111111-2222-3333-4444-555555555555',
			address: 'Contact@Example.com',
			destination: 'support@helpdesk.example',
			encryptionKeyFingerprint: 'AB'.repeat(32),
			issuedAt: '2026-09-17T12:00:00Z',
			signerKeyFingerprint: 'cd'.repeat(32)
		});
		expect(new TextDecoder().decode(bytes)).toBe(GO_CANONICAL);
	});

	it('names the plain permission and carries no key fingerprint', () => {
		const bytes = canonicaliseAuthorization({
			accountId: '11111111-2222-3333-4444-555555555555',
			address: 'contact@example.com',
			destination: 'someone@gmail.com',
			encryptionKeyFingerprint: '',
			issuedAt: '2026-09-17T12:00:00Z',
			signerKeyFingerprint: 'cd'.repeat(32),
			permission: 'forward-plaintext'
		});
		const text = new TextDecoder().decode(bytes);
		expect(text).toContain('"encryptionKeyFingerprint":""');
		expect(text).toContain('"permissions":["forward-plaintext"]');
	});

	it('formats issuedAt as whole-second RFC 3339', () => {
		expect(authorizationTimestamp(Date.parse('2026-09-17T12:00:00.987Z'))).toBe('2026-09-17T12:00:00Z');
	});
});

describe('generateForwardingKey', () => {
	it('makes one encryption-only subkey bound to the address', async () => {
		const generated = await generateForwardingKey('Contact@Example.com');
		const key = await openpgp.readKey({ armoredKey: generated.publicKeyArmored });
		expect(key.isPrivate()).toBe(false);
		expect(key.getUserIDs()).toEqual(['<contact@example.com>']);
		const subkeys = key.getSubkeys();
		expect(subkeys).toHaveLength(1);
		const flags = subkeys[0].bindingSignatures[0].keyFlags![0];
		expect(flags & openpgp.enums.keyFlags.signData).toBe(0);
		expect(flags & openpgp.enums.keyFlags.encryptCommunication).not.toBe(0);
		expect(generated.keyFingerprintHex).toBe(key.getFingerprint().toLowerCase());
		expect(key.keyPacket.version).toBe(6);
		expect(generated.keyFingerprintHex).toMatch(/^[0-9a-f]{64}$/);
		expect(subkeys[0].keyPacket.version).toBe(6);
		expect(subkeys[0].getAlgorithmInfo().algorithm).toBe('x25519');
		const priv = await openpgp.readPrivateKey({ armoredKey: generated.privateKeyArmored });
		expect(priv.isDecrypted()).toBe(true);
	});
});
