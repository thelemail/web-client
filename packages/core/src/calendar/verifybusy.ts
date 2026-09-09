import * as openpgp from 'openpgp';
import { b64ToBytes } from '$core/crypto';
import { b64ToHex } from '$core/keys/encode';
import { canonicalise, type BusyStatement } from './busycanon';

export type BusyTrust =
	| 'verified'
	| 'signature_failed'
	| 'key_mismatch'
	| 'key_unresolved'
	| 'signer_unknown'
	| 'unsigned';

export interface BusyVerdict {
	trust: BusyTrust;
	signedAtMillis: number | null;
}

export interface VerifyBusyInput {
	statement: BusyStatement;
	signature: string;
	signerKeyFingerprint: string;
	publicKeyArmored: string;
	directoryKeyFingerprintHex: string;
}

function unverified(trust: BusyTrust): BusyVerdict {
	return { trust, signedAtMillis: null };
}

export async function verifyBusyWindows(input: VerifyBusyInput): Promise<BusyVerdict> {
	if (!input.signature || !input.signerKeyFingerprint) return unverified('unsigned');
	if (!input.publicKeyArmored) return unverified('key_unresolved');

	const claimed = b64ToHex(input.signerKeyFingerprint).toLowerCase();
	if (claimed !== input.directoryKeyFingerprintHex.toLowerCase()) {
		return unverified('key_mismatch');
	}

	let publicKey: openpgp.Key;
	let signature: openpgp.Signature;
	try {
		publicKey = await openpgp.readKey({ armoredKey: input.publicKeyArmored });
		signature = await openpgp.readSignature({ binarySignature: b64ToBytes(input.signature) });
	} catch {
		return unverified('signature_failed');
	}

	try {
		const { signatures } = await openpgp.verify({
			message: await openpgp.createMessage({ binary: canonicalise(input.statement) }),
			signature,
			verificationKeys: publicKey,
			format: 'binary'
		});
		if (!signatures.length) return unverified('signature_failed');
		await signatures[0].verified;
		const created = await signatures[0].signature;
		return {
			trust: 'verified',
			signedAtMillis: created.packets[0]?.created?.getTime() ?? null
		};
	} catch {
		return unverified('signature_failed');
	}
}
