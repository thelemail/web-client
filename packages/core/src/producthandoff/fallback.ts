import { ApiCallError } from '$core/api/types';
import { handOffToApp } from '$core/products';
import type { AccountSlotRecord } from '$core/keystore/idb';
import { startHandoff } from './begin';

export async function startFor(accountId: string | null, route: string): Promise<never> {
	try {
		await startHandoff({ expectedAccountId: accountId, route, remember: true });
	} catch (err) {
		if (err instanceof ApiCallError && err.envelope?.error?.code === 'auth_origin_unavailable') return handOffToApp();
		throw err;
	}
	return new Promise<never>(() => {});
}

export function reopen(record: AccountSlotRecord | null, route: string): Promise<never> {
	if (record?.sessionOrigin === 'host') {
		return startFor(record.accountId, route).catch(() => handOffToApp());
	}
	return handOffToApp();
}
