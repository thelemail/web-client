// @vitest-environment node
import * as openpgp from 'openpgp';
import { describe, expect, it } from 'vitest';

import {
	authorizationTimestamp,
	canonicaliseAuthorization,
	generateForwardingKey
} from './forwardingKey';
import vectors from '../interop/vectors/statements.json';

const authVector = vectors.cases.find((c) => c.kind === 'readAuthorization' && c.name === 'ok')!;
const trustCanonical = new TextDecoder().decode(Uint8Array.from(atob(authVector.raw), (c) => c.charCodeAt(0)));
const trustFields = JSON.parse(trustCanonical) as {
	accountId: string;
	address: string;
	destination: string;
	encryptionKeyFingerprint: string;
	issuedAt: string;
	signerKeyFingerprint: string;
};

describe('forwarding authorization', () => {
	it('matches the trust canonicaliser byte for byte, whatever the input case', () => {
		const bytes = canonicaliseAuthorization({
			accountId: trustFields.accountId,
			address: trustFields.address.toUpperCase(),
			destination: trustFields.destination,
			encryptionKeyFingerprint: trustFields.encryptionKeyFingerprint.toUpperCase(),
			issuedAt: trustFields.issuedAt,
			signerKeyFingerprint: trustFields.signerKeyFingerprint
		});
		expect(new TextDecoder().decode(bytes)).toBe(trustCanonical);
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
