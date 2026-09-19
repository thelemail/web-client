import { bytesToB64 } from '$core/crypto';
import { hexToB64 } from '$core/keys/encode';
import { keystore } from '$core/keystore/keystore-client';
import { m } from '$paraglide/messages.js';
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
			m.cal_busy_sign_failed()
		);
	}
	return {
		signature: bytesToB64(res.signature),
		signerKeyFingerprint: hexToB64(res.keyFingerprintHex)
	};
}
