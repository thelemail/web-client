import * as openpgp from 'openpgp';

import { keyCreationDate } from '$core/keystore/opaque-params';

export interface GeneratedDelegationKey {
	publicKeyArmored: string;
	revokedPublicKeyArmored: string;
	privateKeyArmored: string;
	keyFingerprintHex: string;
	notAfter: string;
}

export interface GenerateDelegationKeyOptions {
	email: string;
	validForDays: number;
	now?: number;
}

export async function generateDelegationKey({
	email,
	validForDays,
	now = Date.now()
}: GenerateDelegationKeyOptions): Promise<GeneratedDelegationKey> {
	const date = keyCreationDate(now);
	const keyExpirationTime = Math.round(validForDays * 24 * 60 * 60);
	const generated = await openpgp.generateKey({
		type: 'curve25519',
		userIDs: [{ email }],
		subkeys: [],
		keyExpirationTime,
		date,
		format: 'object'
	});
	const { publicKey: revoked } = await openpgp.revokeKey({
		key: generated.privateKey,
		reasonForRevocation: { flag: openpgp.enums.reasonForRevocation.keyRetired },
		format: 'object'
	});
	return {
		publicKeyArmored: generated.publicKey.armor(),
		revokedPublicKeyArmored: revoked.armor(),
		privateKeyArmored: generated.privateKey.armor(),
		keyFingerprintHex: generated.publicKey.getFingerprint(),
		notAfter: new Date(date.getTime() + keyExpirationTime * 1000).toISOString()
	};
}
