import * as openpgp from 'openpgp';

import {
	canonicaliseDelegation,
	DelegationVerificationError,
	parseDelegationStatement,
	type DelegationStatement
} from './delegation-statement';
import {
	DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX,
	DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED
} from './signing-key';

export * from './delegation-statement';

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

async function fingerprintOf(armoredKey: string): Promise<string> {
	const key = await openpgp.readKey({ armoredKey });
	const fp = key.getFingerprint();
	if (typeof fp === 'string') return fp.toLowerCase();
	return bytesToHex(new Uint8Array(fp as ArrayLike<number>));
}

export interface DelegationForVerification {
	address: string;
	publicKeyArmored: string;
	statement?: string;
	statementSignature?: string;
}

/**
 * Verifies that the operator signed this delegation for the address being
 * looked up, and that the published certificate is the one the statement names
 * and cannot be used to encrypt.
 */
export async function verifyDelegation(
	delegation: DelegationForVerification,
	requestedAddress: string
): Promise<DelegationStatement> {
	if (!delegation.statement || !delegation.statementSignature) {
		throw new DelegationVerificationError('statement_malformed', 'delegation is unsigned');
	}
	const raw = base64ToBytes(delegation.statement);
	const statement = parseDelegationStatement(raw);

	if (
		statement.signingKeyFingerprint.toLowerCase() !==
		DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX.toLowerCase()
	) {
		throw new DelegationVerificationError(
			'signing_key_mismatch',
			'delegation was signed by an unknown directory key'
		);
	}
	if (statement.address.toLowerCase() !== requestedAddress.toLowerCase()) {
		throw new DelegationVerificationError(
			'address_mismatch',
			'delegation is for a different address'
		);
	}

	const served = await openpgp.readKey({ armoredKey: delegation.publicKeyArmored });
	const servedFingerprint = await fingerprintOf(delegation.publicKeyArmored);
	if (servedFingerprint !== statement.signerFingerprint.toLowerCase()) {
		throw new DelegationVerificationError(
			'fingerprint_mismatch',
			'the published certificate does not match the signed statement'
		);
	}

	if (served.getSubkeys().length > 0) {
		throw new DelegationVerificationError('not_sign_only', 'a delegation must have no subkeys');
	}
	let encryptionCapable = false;
	try {
		await served.getEncryptionKey();
		encryptionCapable = true;
	} catch {
		encryptionCapable = false;
	}
	if (encryptionCapable) {
		throw new DelegationVerificationError(
			'not_sign_only',
			'a delegation must not be encryption-capable'
		);
	}

	const signingKey = await openpgp.readKey({ armoredKey: DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED });
	const signature = await openpgp.readSignature({
		binarySignature: base64ToBytes(delegation.statementSignature)
	});
	const message = await openpgp.createMessage({ binary: canonicaliseDelegation(statement) });
	const result = await openpgp.verify({
		message,
		signature,
		verificationKeys: signingKey as openpgp.PublicKey
	});
	try {
		await result.signatures[0].verified;
	} catch {
		throw new DelegationVerificationError(
			'signature_invalid',
			'the delegation signature did not verify'
		);
	}
	return statement;
}

