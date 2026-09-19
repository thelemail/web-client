import { m } from '$paraglide/messages.js';
import { serverNow } from '$core/api/serverclock';
import { bytesToB64 } from '$core/crypto';
import { keystore } from '$core/keystore/keystore-client';
import type { ReadDelegationMode } from '$core/api/readDelegations';
import {
	armorDetachedSignature,
	authorizationTimestamp,
	canonicaliseAuthorization,
	generateForwardingKey
} from '$core/keys/forwardingKey';

export interface PreparedForwarding {
	publicKeyArmored?: string;
	privateKeyArmored?: string;
	keyFingerprintHex?: string;
	authorization: string;
	authorizationSignature: string;
}

export class ForwardingSetupError extends Error {
	readonly code: 'locked' | 'unknown';

	constructor(code: 'locked' | 'unknown', message: string) {
		super(message);
		this.name = 'ForwardingSetupError';
		this.code = code;
	}
}

function hex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function prepareForwarding(
	accountId: string,
	address: string,
	destination: string,
	mode: ReadDelegationMode = 'encrypted'
): Promise<PreparedForwarding> {
	const own = await keystore.getPublicKey({ accountId });
	if (!own.ok) {
		throw new ForwardingSetupError('locked', m.settings_forwarding_err_unlock());
	}
	const generated = mode === 'plain' ? null : await generateForwardingKey(address, serverNow());
	const authorization = canonicaliseAuthorization({
		accountId,
		address,
		destination,
		encryptionKeyFingerprint: generated?.keyFingerprintHex ?? '',
		issuedAt: authorizationTimestamp(serverNow()),
		signerKeyFingerprint: hex(own.fingerprint),
		permission: mode === 'plain' ? 'forward-plaintext' : 'decrypt-forwarded'
	});
	const signed = await keystore.signDetached({ accountId, data: authorization });
	if (!signed.ok) {
		throw new ForwardingSetupError(
			signed.code === 'locked' ? 'locked' : 'unknown',
			signed.code === 'locked' ? m.settings_forwarding_err_unlock() : m.settings_forwarding_err_sign()
		);
	}
	if (signed.keyFingerprintHex.toLowerCase() !== hex(own.fingerprint)) {
		throw new ForwardingSetupError('unknown', m.settings_forwarding_err_sign());
	}
	const armored = await armorDetachedSignature(signed.signature);
	return {
		publicKeyArmored: generated?.publicKeyArmored,
		privateKeyArmored: generated?.privateKeyArmored,
		keyFingerprintHex: generated?.keyFingerprintHex,
		authorization: bytesToB64(authorization),
		authorizationSignature: bytesToB64(new TextEncoder().encode(armored))
	};
}
