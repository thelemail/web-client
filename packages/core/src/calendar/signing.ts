import { ApiCallError } from '$core/api/types';
import { getProductKeys } from '$core/api/productKeys';
import { b64decode } from '$core/keystore/productkeys/encoding';
import { parseDelegation } from '$core/keystore/productkeys/manifests';
import { currentProduct, isProductVault } from '$core/products';

export interface CalendarSigningContext {
	productKeyEpoch: number;
	delegationRevision: number;
}

const contexts = new Map<string, Promise<CalendarSigningContext | null>>();

async function load(accountId: string): Promise<CalendarSigningContext | null> {
	try {
		const res = await getProductKeys(accountId, 'calendar');
		if (!res.delegation) return null;
		const d = parseDelegation(b64decode(res.delegation.record));
		return { productKeyEpoch: d.productKeyEpoch, delegationRevision: d.delegationRevision };
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
