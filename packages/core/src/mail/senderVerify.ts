import { lookupAccount } from '$core/api/accounts';
import { lookupDirectory } from '$core/directory/lookup';
import { acceptExternalKey, lookupExternalKey } from '$core/api/externalKeys';
import { getMyWorkspace } from '$core/api/workspaces';
import { ApiCallError, type ExternalKeyTrust } from '$core/api/types';
import {
	verifyDirectoryLookup,
	verifiedPreviousKey,
	DirectoryVerificationError,
	type DirectoryStatement,
	type KeyTransitionResult,
	type TlogOutcome
} from '$core/directory/verify';
import { b64ToHex } from '$core/keys/encode';
import { keystore } from '$core/keystore/keystore-client';
import { verifyDelegation } from '$core/directory/delegation';
import type {
	DirectoryVerificationCode,
	DirectoryVerificationDetails
} from '$core/directory/errors';

export interface DirectoryTrust {
	ok: boolean;
	missing?: boolean;
	statement?: DirectoryStatement;
	publicKeyArmored?: string;
	firstContact: boolean;
	sameWorkspace: boolean;
	verifiedAtMillis?: number;
	tlog: TlogOutcome;
	transition?: KeyTransitionResult;
	code?: DirectoryVerificationCode;
	details?: DirectoryVerificationDetails;
}

export interface DelegatedSignerTrust {
	label: string;
	address: string;
	revokedAt?: string | null;
}

export interface ExternalKeyState {
	status: ExternalKeyTrust['status'];
	fingerprintHex?: string;
	fingerprintB64?: string;
	previousFingerprintHex?: string;
	previousFirstSeenAtMillis?: number;
	source?: ExternalKeyTrust['source'];
	armoredKey?: string;
	firstSeenAtMillis?: number;
}

export interface PreviousSenderKey {
	fingerprintHex: string;
	publicKeyArmored: string;
	retiredAtMillis: number;
}

const TRUST_TTL_MS = 2 * 60 * 1000;

const directoryCache = new Map<string, { value: DirectoryTrust; at: number }>();
const delegationCache = new Map<string, { value: DelegatedSignerTrust | null; at: number }>();
const externalCache = new Map<string, { value: ExternalKeyState | null; at: number }>();
const previousKeyCache = new Map<string, { value: PreviousSenderKey | null; at: number }>();

function millis(iso: string | undefined): number | undefined {
	if (!iso) return undefined;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? undefined : t;
}

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

if (typeof window !== 'undefined') {
	keystore.subscribe((msg) => {
		if (msg.type === 'clearedAll' || (msg.type === 'accountKeysChanged' && msg.currentChanged)) {
			forgetAllSenderTrust();
		}
	});
}

export async function directoryTrust(
	accountId: string,
	senderAddress: string,
	opts: { acceptFingerprint?: string } = {}
): Promise<DirectoryTrust | null> {
	const address = senderAddress.trim().toLowerCase();
	if (!address) return null;
	const key = `${accountId}:${address}`;
	if (!opts.acceptFingerprint) {
		const hit = directoryCache.get(key);
		if (hit && Date.now() - hit.at < TRUST_TTL_MS) return hit.value;
	}
	let value: DirectoryTrust;
	try {
		const lookup = await lookupDirectory(address);
		const res = await verifyDirectoryLookup(lookup, address, opts);
		const mine = await ownWorkspaceId(accountId);
		value = {
			ok: true,
			statement: res.statement,
			publicKeyArmored: res.publicKeyArmored,
			firstContact: res.firstContact,
			sameWorkspace: Boolean(lookup.workspaceId && lookup.workspaceId === mine),
			verifiedAtMillis: res.verifiedAt.getTime(),
			tlog: res.tlog,
			transition: res.transition
		};
	} catch (e) {
		if (e instanceof ApiCallError && e.status === 404) {
			value = {
				ok: false,
				missing: true,
				firstContact: false,
				sameWorkspace: false,
				tlog: { state: 'not_configured' }
			};
		} else if (e instanceof DirectoryVerificationError) {
			value = {
				ok: false,
				firstContact: false,
				sameWorkspace: false,
				tlog: e.tlog ?? { state: 'not_configured' },
				code: e.code,
				details: e.details
			};
		} else {
			return null;
		}
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
			fingerprintHex: trust.fingerprint ? b64ToHex(trust.fingerprint) : undefined,
			fingerprintB64: trust.fingerprint || undefined,
			previousFingerprintHex: trust.previousFingerprint ? b64ToHex(trust.previousFingerprint) : undefined,
			previousFirstSeenAtMillis: millis(trust.previousFirstSeenAt),
			source: trust.source,
			armoredKey: trust.armoredKey,
			firstSeenAtMillis: millis(trust.firstSeenAt)
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
	for (const key of [...previousKeyCache.keys()]) {
		if (key.startsWith(`${address}:`)) previousKeyCache.delete(key);
	}
	externalCache.delete(address);
}

export function forgetAllSenderTrust(): void {
	directoryCache.clear();
	previousKeyCache.clear();
	externalCache.clear();
}

export async function acceptSenderKeyChange(
	accountId: string,
	senderAddress: string
): Promise<void> {
	const address = senderAddress.trim().toLowerCase();
	if (!address) return;
	const shown = directoryCache.get(`${accountId}:${address}`)?.value;
	forgetSenderTrust(address);
	const external = await externalKeyState(address);
	if (external?.status === 'changed' && external.fingerprintB64) {
		await acceptExternalKey(address, external.fingerprintB64);
		externalCache.delete(address);
		return;
	}
	const seen =
		shown?.code === 'fingerprint_changed' ? shown : await directoryTrust(accountId, address);
	const fingerprint = seen?.code === 'fingerprint_changed' ? seen.details?.currentFingerprint : undefined;
	if (!fingerprint) return;
	forgetSenderTrust(address);
	await directoryTrust(accountId, address, { acceptFingerprint: fingerprint });
}

export async function previousSenderKey(
	accountId: string,
	senderAddress: string,
	fingerprintHex: string
): Promise<PreviousSenderKey | null> {
	const address = senderAddress.trim().toLowerCase();
	const fingerprint = fingerprintHex.toLowerCase();
	if (!address || !fingerprint) return null;
	const key = `${address}:${fingerprint}`;
	const hit = previousKeyCache.get(key);
	if (hit && Date.now() - hit.at < TRUST_TTL_MS) return hit.value;
	let value: PreviousSenderKey | null = null;
	const trust = await directoryTrust(accountId, address);
	const listed = trust?.ok && trust.statement?.keyTransitions.some((t) => t.previousKeyFingerprint === fingerprint);
	if (listed) {
		try {
			const lookup = await lookupDirectory(address, { previousKeyFingerprint: fingerprint });
			const res = await verifyDirectoryLookup(lookup, address);
			const found = await verifiedPreviousKey(res.statement, lookup.previousKey, fingerprint);
			if (found) {
				value = {
					fingerprintHex: fingerprint,
					publicKeyArmored: found.publicKeyArmored,
					retiredAtMillis: found.transition.retiredAtMillis
				};
			}
		} catch {
			value = null;
		}
	}
	previousKeyCache.set(key, { value, at: Date.now() });
	return value;
}

export async function delegatedSignerTrust(
	senderAddress: string,
	delegationId: string
): Promise<DelegatedSignerTrust | null> {
	const address = senderAddress.trim().toLowerCase();
	if (!address || !delegationId) return null;
	const key = `${address}:${delegationId}`;
	const hit = delegationCache.get(key);
	if (hit && Date.now() - hit.at < TRUST_TTL_MS) return hit.value;

	let value: DelegatedSignerTrust | null = null;
	try {
		const lookup = await lookupAccount(address);
		const match = lookup.delegations?.find((d) => d.id === delegationId);
		if (match) {
			const statement = await verifyDelegation(match, address);
			value = {
				label: match.label,
				address: statement.address,
				revokedAt: statement.revokedAt
			};
		}
	} catch {
		value = null;
	}
	delegationCache.set(key, { value, at: Date.now() });
	return value;
}
