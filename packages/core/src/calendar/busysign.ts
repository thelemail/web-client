import { bytesToB64 } from '$core/crypto';
import { hexToB64 } from '$core/keys/encode';
import { requireConfirmedOwnKey } from '$core/stores/accountKeys.svelte';
import { keystore } from '$core/keystore/keystore-client';
import { m } from '$paraglide/messages.js';
import { canonicalise, type BusyStatement } from './busycanon';
import { BUSY_FUTURE_DAYS, BUSY_PAST_DAYS } from './recur';
import { SealError } from './seal';
import { calendarSigningContext } from './signing';

export interface BusySignature {
	signature: string;
	signerKeyFingerprint: string;
	statement?: string;
}

const DAY = 86400000;

function windowPairs(statement: BusyStatement): [number, number][] {
	return statement.windows
		.map((w): [number, number] => [Date.parse(w.startsAt), Date.parse(w.endsAt)])
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export async function signBusyWindows(
	accountId: string,
	statement: BusyStatement,
	now = new Date()
): Promise<BusySignature> {
	const ctx = await calendarSigningContext(accountId);
	if (ctx) {
		if (statement.privacy !== 'busy' && statement.privacy !== 'shared') {
			throw new SealError('unknown', m.cal_busy_sign_failed());
		}
		const res = await keystore.signFreeBusy({
			accountId,
			productKeyEpoch: ctx.productKeyEpoch,
			delegationRevision: ctx.delegationRevision,
			calendarId: statement.calendarId.toLowerCase(),
			itemId: statement.itemId.toLowerCase(),
			privacy: statement.privacy,
			revision: statement.rev,
			rangeStart: now.getTime() - (BUSY_PAST_DAYS + 1) * DAY,
			rangeEnd: now.getTime() + (BUSY_FUTURE_DAYS + 1) * DAY,
			windows: windowPairs(statement)
		});
		if (!res.ok) {
			throw new SealError(res.code === 'locked' ? 'locked' : 'unknown', m.cal_busy_sign_failed());
		}
		return {
			signature: bytesToB64(res.signature),
			signerKeyFingerprint: bytesToB64(res.signerFingerprint),
			statement: bytesToB64(res.statement)
		};
	}
	await requireConfirmedOwnKey(accountId);
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
