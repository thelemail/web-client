import { lookupAccount } from '$lib/api/accounts';
import { lookupExternalKey } from '$lib/api/externalKeys';
import { getMyWorkspace } from '$lib/api/workspaces';
import type { ExternalKeyTrust } from '$lib/api/types';
import {
	verifyDirectoryLookup,
	DirectoryVerificationError,
	type DirectoryStatement,
	type TlogOutcome
} from '$lib/directory/verify';
import type {
	DirectoryVerificationCode,
	DirectoryVerificationDetails
} from '$lib/directory/errors';

export interface DirectoryTrust {
	ok: boolean;
	statement?: DirectoryStatement;
	publicKeyArmored?: string;
	firstContact: boolean;
	sameWorkspace: boolean;
	verifiedAtMillis?: number;
	tlog: TlogOutcome;
	code?: DirectoryVerificationCode;
	details?: DirectoryVerificationDetails;
}

export interface ExternalKeyState {
	status: ExternalKeyTrust['status'];
	fingerprint?: string;
	source?: ExternalKeyTrust['source'];
	armoredKey?: string;
	firstSeenAtMillis?: number;
}

const TRUST_TTL_MS = 2 * 60 * 1000;

const directoryCache = new Map<string, { value: DirectoryTrust; at: number }>();
const externalCache = new Map<string, { value: ExternalKeyState | null; at: number }>();

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

export async function directoryTrust(
	accountId: string,
	senderAddress: string,
	opts: { acceptKeyChange?: boolean } = {}
): Promise<DirectoryTrust | null> {
	const address = senderAddress.trim().toLowerCase();
	if (!address) return null;
	const key = `${accountId}:${address}`;
	if (!opts.acceptKeyChange) {
		const hit = directoryCache.get(key);
		if (hit && Date.now() - hit.at < TRUST_TTL_MS) return hit.value;
	}
	let value: DirectoryTrust;
	try {
		const lookup = await lookupAccount(address);
		const res = await verifyDirectoryLookup(lookup, address, opts);
		const mine = await ownWorkspaceId(accountId);
		value = {
			ok: true,
			statement: res.statement,
			publicKeyArmored: res.publicKeyArmored,
			firstContact: res.firstContact,
			sameWorkspace: Boolean(lookup.workspaceId && lookup.workspaceId === mine),
			verifiedAtMillis: res.verifiedAt.getTime(),
			tlog: res.tlog
		};
	} catch (e) {
		if (!(e instanceof DirectoryVerificationError)) return null;
		value = {
			ok: false,
			firstContact: false,
			sameWorkspace: false,
			tlog: { state: 'not_configured' },
			code: e.code,
			details: e.details
		};
	}
	directoryCache.set(key, { value, at: Date.now() });
	return value;
}

export async function externalKeyState(senderAddress: string): Promise<ExternalKeyState | null> {
	const address = senderAddress.trim().toLowerCase();
	if (!address) return null;
	const hit = externalCache.get(address);
	if (hit && Date.now() - hit.at < TRUST_TTL_MS) return hit.value;
	let value: ExternalKeyState | null;
	try {
		const trust = await lookupExternalKey(address);
		value = {
			status: trust.status,
			fingerprint: trust.fingerprint,
			source: trust.source,
			armoredKey: trust.armoredKey,
			firstSeenAtMillis: trust.firstSeenAt ? Date.parse(trust.firstSeenAt) : undefined
		};
	} catch {
		value = null;
	}
	externalCache.set(address, { value, at: Date.now() });
	return value;
}

export function forgetSenderTrust(senderAddress: string): void {
	const address = senderAddress.trim().toLowerCase();
	for (const key of [...directoryCache.keys()]) {
		if (key.endsWith(`:${address}`)) directoryCache.delete(key);
	}
	externalCache.delete(address);
}
