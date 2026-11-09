/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { OpaqueOperations } from '../opaque-ops';
import { CryptoProxy } from '@protontech/crypto';
import { Api as CryptoApi } from '@protontech/crypto/proxy/endpoint/api.ts';
import { clearAllVaults, deleteVault, getAllVaults, putVault } from '../idb';
import type { VaultRecord } from '../idb';
import type { Broadcast, ClearArgs, LockArgs, StatusResponse } from '../protocol';

export const pendingFlows: {
	login: PendingLogin | null;
	recoveryLogin: PendingRecoveryLogin | null;
	reset: PendingReset | null;
	passwordChange: PendingPasswordChange | null;
} = { login: null, recoveryLogin: null, reset: null, passwordChange: null };

export interface VaultState {
	accountId: string;
	email: string;
	authScheme: 'srp_v1' | 'opaque_v1';
	srpSalt?: string;
	keySalt?: string;
	wrappedMasterKey?: string;
	masterKeyId?: string;
	opaqueParamsVersion?: number;
	masterKey?: Uint8Array;
	armoredEncryptedPrivateKey: string;
	privateKey: openpgp.PrivateKey;
	keyPassword: string;
	wrapKey?: CryptoKey;
	accountKeys: Map<string, AccountKeyEntry>;
	keyVersion: number;
	aliasKeys: Map<string, AliasKeyEntry>;
	aliasCurrent: Map<string, string>;
	product?: 'app' | 'calendar';
}

export interface AccountKeyEntry {
	keyVersion: number;
	fingerprintHex: string;
	privateKey: openpgp.PrivateKey;
	armoredEncrypted: string;
	provisional?: boolean;
}

export interface PendingRotation {
	fingerprintHex: string;
	keyVersion: number;
	privateKey: openpgp.PrivateKey;
	armoredEncrypted: string;
	expiresAt: number;
}

export interface AliasKeyEntry {
	aliasId: string;
	addressId: string;
	email: string;
	keyVersion: number;
	fingerprintHex: string;
	privateKey: openpgp.PrivateKey;
}

export interface PendingLogin {
	email: string;
	password: string;
	expectedServerProof: string;
	proofVerified: boolean;
	verifiedAt: number | null;
}

export const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;

export interface PendingRecoveryLogin {
	email: string;
	phrase: string;
	expectedServerProof: string;
	proofVerified: boolean;
	verifiedAt: number | null;
}

export interface PendingReset {
	email: string;
	privateKey: openpgp.PrivateKey;
	expiresAt: number;
}

export interface PendingPasswordChange {
	accountId: string;
	expectedServerProof: string;
	proofVerified: boolean;
	verifiedAt: number | null;
	newCredentials: {
		srpSalt: string;
		keySalt: string;
		armoredEncryptedPrivateKey: string;
	} | null;
}

export const vaults = new Map<string, VaultState>();
export const indexKeys = new Map<string, CryptoKey>();
export const cachedRecords = new Map<string, VaultRecord>();
export const pendingRotations = new Map<string, PendingRotation>();
export let cryptoReady: Promise<void> | null = null;
export const ports = new Set<MessagePort>();
export const opaqueOps = new OpaqueOperations();

export const restorePromise = restoreFromIdb();

export async function restoreFromIdb() {
	try {
		const all = await getAllVaults();
		for (const rec of all) {
			cachedRecords.set(rec.accountId, rec);
		}
	} catch (err) {
		console.warn('keystore: idb restore failed', err);
	}
}

export async function ensureCryptoReady(): Promise<void> {
	if (cryptoReady) return cryptoReady;
	cryptoReady = (async () => {
		CryptoApi.init({});
		const api = new CryptoApi();
		try {
			CryptoProxy.setEndpoint(api);
		} catch (err) {
			if (!(err instanceof Error) || !/already initialised/i.test(err.message)) {
				throw err;
			}
		}
	})();
	return cryptoReady;
}

export function broadcast(msg: Broadcast) {
	for (const p of ports) {
		p.postMessage(msg);
	}
}

export function wipe(s: string): void {
	void s;
}

export function hasPersistentFor(rec: VaultRecord | undefined): boolean {
	return !!(
		rec &&
		(rec.localHalfKey || rec.localHalfHolder === 'page') &&
		rec.wrappedPrivateKey &&
		rec.wrapIv
	);
}

export async function handleStatus(): Promise<StatusResponse> {
	await restorePromise;
	const seen = new Set<string>();
	const accounts: StatusResponse['accounts'] = [];
	for (const v of vaults.values()) {
		const rec = cachedRecords.get(v.accountId);
		accounts.push({
			accountId: v.accountId,
			email: v.email,
			unlocked: true,
			hasPersistent: hasPersistentFor(rec),
			authScheme: v.authScheme
		});
		seen.add(v.accountId);
	}
	for (const rec of cachedRecords.values()) {
		if (seen.has(rec.accountId)) continue;
		accounts.push({
			accountId: rec.accountId,
			email: rec.email,
			unlocked: false,
			hasPersistent: hasPersistentFor(rec),
			authScheme: rec.authScheme
		});
	}
	return { accounts };
}

export async function handleClear(args: ClearArgs): Promise<void> {
	vaults.delete(args.accountId);
	pendingRotations.delete(args.accountId);
	indexKeys.delete(args.accountId);
	cachedRecords.delete(args.accountId);
	await deleteVault(args.accountId);
	broadcast({ type: 'cleared', accountId: args.accountId });
}

export async function handleClearAll(): Promise<void> {
	vaults.clear();
	indexKeys.clear();
	cachedRecords.clear();
	pendingRotations.clear();
	pendingFlows.login = null;
	pendingFlows.recoveryLogin = null;
	pendingFlows.reset = null;
	pendingFlows.passwordChange = null;
	opaqueOps.clear();
	await clearAllVaults();
	broadcast({ type: 'clearedAll' });
}

export function handleLock(args: LockArgs): void {
	indexKeys.delete(args.accountId);
	pendingRotations.delete(args.accountId);
	if (vaults.delete(args.accountId)) {
		broadcast({ type: 'locked', accountId: args.accountId });
	}
}

export function base64ToBytes(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

export function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) {
		out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

export function fingerprintHexOf(key: openpgp.Key): string {
	const fp = key.getFingerprint();
	if (typeof fp === 'string') return fp.toLowerCase();
	return [...new Uint8Array(fp as ArrayLike<number>)]
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export function recomputeAliasCurrent(v: VaultState) {
	v.aliasCurrent.clear();
	const best = new Map<string, AliasKeyEntry>();
	for (const entry of v.aliasKeys.values()) {
		const cur = best.get(entry.aliasId);
		if (!cur || entry.keyVersion > cur.keyVersion) best.set(entry.aliasId, entry);
	}
	for (const [aliasId, entry] of best) v.aliasCurrent.set(aliasId, entry.fingerprintHex);
}

export function storedAccountKeys(v: VaultState): Pick<VaultRecord, 'accountKeys' | 'keyVersion'> {
	return {
		accountKeys: [...v.accountKeys.values()]
			.sort((a, b) => b.keyVersion - a.keyVersion)
			.map((e) => ({
				keyVersion: e.keyVersion,
				fingerprintHex: e.fingerprintHex,
				armoredEncryptedPrivateKey: e.armoredEncrypted,
				...(e.provisional ? { provisional: true } : {})
			})),
		keyVersion: v.keyVersion
	};
}

export function knowsKeyHistory(accountId: string): boolean {
	const v = vaults.get(accountId);
	if (v && (v.accountKeys.size > 1 || v.keyVersion > 1)) return true;
	const rec = cachedRecords.get(accountId);
	return !!rec && ((rec.accountKeys?.length ?? 0) > 1 || (rec.keyVersion ?? 1) > 1);
}

export async function unlockAccountKey(
	armored: string,
	passphrase: string
): Promise<{ privateKey: openpgp.PrivateKey; fingerprintHex: string } | null> {
	try {
		const locked = await openpgp.readPrivateKey({ armoredKey: armored });
		const privateKey = await openpgp.decryptKey({ privateKey: locked, passphrase });
		return { privateKey, fingerprintHex: fingerprintHexOf(privateKey) };
	} catch {
		return null;
	}
}

export async function seedAccountKeys(v: VaultState, rec?: VaultRecord): Promise<void> {
	const loginFp = fingerprintHexOf(v.privateKey);
	const stored = rec?.accountKeys ?? [];
	const known = stored.find((k) => k.fingerprintHex === loginFp);
	const login: AccountKeyEntry = {
		keyVersion:
			known?.keyVersion ??
			(stored.length
				? Math.max(...stored.map((k) => k.keyVersion), rec?.keyVersion ?? 1) + 1
				: (rec?.keyVersion ?? 1)),
		fingerprintHex: loginFp,
		privateKey: v.privateKey,
		armoredEncrypted: v.armoredEncryptedPrivateKey,
		...(known && !known.provisional ? {} : { provisional: true })
	};
	v.accountKeys = new Map();
	if (v.authScheme === 'opaque_v1' && v.keyPassword) {
		for (const k of stored) {
			if (k.fingerprintHex === loginFp) continue;
			const unlocked = await unlockAccountKey(k.armoredEncryptedPrivateKey, v.keyPassword);
			if (!unlocked || unlocked.fingerprintHex !== k.fingerprintHex) {
				console.warn('keystore: stored account key did not unlock', k.keyVersion);
				continue;
			}
			v.accountKeys.set(k.fingerprintHex, {
				keyVersion: k.keyVersion,
				fingerprintHex: k.fingerprintHex,
				privateKey: unlocked.privateKey,
				armoredEncrypted: k.armoredEncryptedPrivateKey,
				...(k.provisional ? { provisional: true } : {})
			});
		}
	}
	let best: AccountKeyEntry | undefined = login.provisional ? undefined : login;
	for (const entry of v.accountKeys.values()) {
		if (!entry.provisional && (!best || entry.keyVersion > best.keyVersion)) best = entry;
	}
	if (!best || best === login || !login.provisional || known) v.accountKeys.set(loginFp, login);
	makeCurrent(v, best ?? login);
}

export async function persistAccountKeys(v: VaultState): Promise<void> {
	const prev = cachedRecords.get(v.accountId);
	if (!prev) return;
	const updated: VaultRecord = {
		...prev,
		armoredEncryptedPrivateKey: v.armoredEncryptedPrivateKey,
		...storedAccountKeys(v),
		updatedAt: Date.now()
	};
	await putVault(updated);
	cachedRecords.set(v.accountId, updated);
}

export function announceAccountKeys(v: VaultState, currentChanged: boolean): void {
	broadcast({
		type: 'accountKeysChanged',
		accountId: v.accountId,
		fingerprints: [...v.accountKeys.keys()],
		currentFingerprintHex: fingerprintHexOf(v.privateKey),
		keyVersion: v.keyVersion,
		currentChanged
	});
}

export function makeCurrent(v: VaultState, entry: AccountKeyEntry): void {
	v.privateKey = entry.privateKey;
	v.armoredEncryptedPrivateKey = entry.armoredEncrypted;
	v.keyVersion = entry.keyVersion;
}

export function accountKeysByVersion(v: VaultState): openpgp.PrivateKey[] {
	const current = fingerprintHexOf(v.privateKey);
	const older = [...v.accountKeys.values()]
		.filter((e) => e.fingerprintHex !== current)
		.sort((a, b) => b.keyVersion - a.keyVersion)
		.map((e) => e.privateKey);
	return [v.privateKey, ...older];
}

export async function unwrapWithAccountKeys(
	v: VaultState,
	armored: string,
	memberFingerprintHex?: string
): Promise<string | null> {
	const message = await openpgp.readMessage({ armoredMessage: armored });
	const hint = memberFingerprintHex?.toLowerCase();
	const hinted = hint ? v.accountKeys.get(hint)?.privateKey : undefined;
	const attempts = hinted ? [hinted, accountKeysByVersion(v)] : [accountKeysByVersion(v)];
	let lastError: unknown = null;
	for (const decryptionKeys of attempts) {
		try {
			const { data } = await openpgp.decrypt({ message, decryptionKeys, expectSigned: false });
			return typeof data === 'string' ? data : null;
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError;
}

export function constantTimeEqual(aB64: string, bB64: string): boolean {
	const a = atob(aB64);
	const b = atob(bB64);
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}
