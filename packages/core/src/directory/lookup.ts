import { lookupAccount } from '$core/api/accounts';
import type { AccountLookupResponse } from '$core/api/types';
import { TLOG_POLICY } from './tlog/policy';
import { tlogStateStore } from './tlog/state-idb';

async function acceptedTreeSize(): Promise<number | undefined> {
	if (!TLOG_POLICY) return undefined;
	try {
		return (await tlogStateStore.get(TLOG_POLICY.origin))?.treeSize;
	} catch {
		return undefined;
	}
}

export async function lookupDirectory(email: string): Promise<AccountLookupResponse> {
	return lookupAccount(email, await acceptedTreeSize());
}
