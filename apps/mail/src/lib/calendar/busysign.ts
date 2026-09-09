import { bytesToB64 } from '$lib/crypto';
import { hexToB64 } from '$lib/keys/encode';
import { keystore } from '$lib/keystore/keystore-client';
import { canonicalise, type BusyStatement } from './busycanon';
import { SealError } from './seal';

export interface BusySignature {
	signature: string;
	signerKeyFingerprint: string;
}

export async function signBusyWindows(
	accountId: string,
	statement: BusyStatement
): Promise<BusySignature> {
	const res = await keystore.signDetached({ accountId, data: canonicalise(statement) });
	if (!res.ok) {
		throw new SealError(
			res.code === 'locked' ? 'locked' : 'unknown',
			'Could not sign busy windows'
		);
	}
	return {
		signature: bytesToB64(res.signature),
		signerKeyFingerprint: hexToB64(res.keyFingerprintHex)
	};
}
