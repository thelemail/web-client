import { lookupAccount } from '$lib/api/accounts';
import { getMyWorkspace } from '$lib/api/workspaces';
import { verifyDirectoryLookup, DirectoryVerificationError } from '$lib/directory/verify';

export type SenderVerification = 'verified' | 'first_contact' | 'mismatch' | 'unknown';

const VERIFY_TTL_MS = 2 * 60 * 1000;

const cache = new Map<string, { state: SenderVerification; at: number }>();

let workspaceCache: { accountId: string; id: string | null } | null = null;

async function ownWorkspaceId(accountId: string): Promise<string | null> {
	if (workspaceCache?.accountId === accountId) return workspaceCache.id;
	try {
		const ws = await getMyWorkspace();
		workspaceCache = { accountId, id: ws.id };
	} catch {
		return null;
	}
	return workspaceCache.id;
}

export async function verifySender(
	accountId: string,
	senderAddress: string
): Promise<SenderVerification> {
	const address = senderAddress.trim().toLowerCase();
	if (!address) return 'unknown';
	const key = `${accountId}:${address}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < VERIFY_TTL_MS) return hit.state;
	let state: SenderVerification;
	try {
		const lookup = await lookupAccount(address);
		const res = await verifyDirectoryLookup(lookup, address);
		if (!res.firstContact) {
			state = 'verified';
		} else if (lookup.workspaceId && lookup.workspaceId === (await ownWorkspaceId(accountId))) {
			state = 'verified';
		} else {
			state = 'first_contact';
		}
	} catch (e) {
		if (e instanceof DirectoryVerificationError) {
			state = 'mismatch';
		} else {
			return 'unknown';
		}
	}
	cache.set(key, { state, at: Date.now() });
	return state;
}
