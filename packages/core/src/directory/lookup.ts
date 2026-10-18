import { lookupAccount } from '$core/api/accounts';
import type { AccountLookupResponse } from '$core/api/types';
import { getSeen } from './seen-idb';
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

async function pinnedFingerprint(email: string): Promise<string | undefined> {
	try {
		return (await getSeen(email.trim().toLowerCase()))?.keyFingerprint.toLowerCase();
	} catch {
		return undefined;
	}
}

export interface LookupDirectoryOptions {
	previousKeyFingerprint?: string;
}

export async function lookupDirectory(
	email: string,
	opts: LookupDirectoryOptions = {}
): Promise<AccountLookupResponse> {
	const [since, previous] = await Promise.all([
		acceptedTreeSize(),
		opts.previousKeyFingerprint ? Promise.resolve(opts.previousKeyFingerprint) : pinnedFingerprint(email)
	]);
	return lookupAccount(email, since, previous);
}
