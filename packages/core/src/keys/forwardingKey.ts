import * as openpgp from 'openpgp';

import { keyCreationDate } from '$core/keystore/opaque-params';
import { generateCurve25519Key } from './pgpKeys';

export const READ_DELEGATION_AUTHORIZATION_TYPE = 'thelemail-read-delegation/v1';

export interface GeneratedForwardingKey {
	publicKeyArmored: string;
	privateKeyArmored: string;
	keyFingerprintHex: string;
}

export async function generateForwardingKey(email: string, now = Date.now()): Promise<GeneratedForwardingKey> {
	const generated = await generateCurve25519Key({
		userIDs: [{ email: email.trim().toLowerCase() }],
		subkeys: [{ sign: false }],
		date: keyCreationDate(now)
	});
	return {
		publicKeyArmored: generated.publicKey.armor(),
		privateKeyArmored: generated.privateKey.armor(),
		keyFingerprintHex: generated.publicKey.getFingerprint().toLowerCase()
	};
}

export type ReadDelegationPermission = 'decrypt-forwarded' | 'forward-plaintext';

export interface ReadDelegationAuthorization {
	accountId: string;
	address: string;
	destination: string;
	encryptionKeyFingerprint: string;
	issuedAt: string;
	signerKeyFingerprint: string;
	permission?: ReadDelegationPermission;
}

export function authorizationTimestamp(millis: number): string {
	return new Date(Math.floor(millis / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

export function canonicaliseAuthorization(a: ReadDelegationAuthorization): Uint8Array {
	const obj = {
		accountId: a.accountId,
		address: a.address.trim().toLowerCase(),
		destination: a.destination.trim().toLowerCase(),
		encryptionKeyFingerprint: a.encryptionKeyFingerprint.toLowerCase(),
		issuedAt: a.issuedAt,
		permissions: [a.permission ?? 'decrypt-forwarded'],
		signerKeyFingerprint: a.signerKeyFingerprint.toLowerCase(),
		type: READ_DELEGATION_AUTHORIZATION_TYPE
	};
	return new TextEncoder().encode(JSON.stringify(obj));
}

export async function armorDetachedSignature(binary: Uint8Array): Promise<string> {
	const signature = await openpgp.readSignature({ binarySignature: binary });
	return signature.armor();
}
