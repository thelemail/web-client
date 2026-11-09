import { ApiCallError } from '$core/api/types';
import { getProductKeys } from '$core/api/productKeys';
import { decodeCanonical } from '$core/keystore/productkeys/canonical';
import { b64decode } from '$core/keystore/productkeys/encoding';
import { int, MAX_RECORD_BYTES, str } from '$core/keystore/productkeys/fields';
import { currentProduct, isProductVault } from '$core/products';

export interface CalendarSigningContext {
	productKeyEpoch: number;
	delegationRevision: number;
	signingKey: Uint8Array;
}

const contexts = new Map<string, Promise<CalendarSigningContext | null>>();

async function load(accountId: string): Promise<CalendarSigningContext | null> {
	try {
		const res = await getProductKeys(accountId, 'calendar');
		if (!res.delegation) return null;
		const d = decodeCanonical(b64decode(res.delegation.record), MAX_RECORD_BYTES);
		if (str(d, 'product') !== 'calendar') return null;
		return {
			productKeyEpoch: int(d, 'productKeyEpoch', 1),
			delegationRevision: int(d, 'delegationRevision', 1),
			signingKey: b64decode(res.delegation.signingPublicKey)
		};
	} catch (err) {
		if (err instanceof ApiCallError && err.status === 404) return null;
		contexts.delete(accountId);
		throw err;
	}
}

export function calendarSigningContext(accountId: string): Promise<CalendarSigningContext | null> {
	if (!isProductVault || currentProduct !== 'calendar') return Promise.resolve(null);
	let ctx = contexts.get(accountId);
	if (!ctx) {
		ctx = load(accountId);
		contexts.set(accountId, ctx);
	}
	return ctx;
}

export function forgetCalendarSigningContext(accountId?: string): void {
	if (accountId) contexts.delete(accountId);
	else contexts.clear();
}
