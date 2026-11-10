/// <reference lib="webworker" />

import { planUids } from '$core/keys/uidPlan';
import * as openpgp from 'openpgp';
import { generateDelegationKey } from '$core/keys/delegationKey';
import {
	generateCurve25519Key,
	lockKey,
	reformatWithUserIDs,
	selfSignaturesPostdateCreation
} from '$core/keys/pgpKeys';
import { keyTransitionPayload, verifyKeyTransition } from '$core/directory/key-transition';
import { putVault } from '../idb';
import type { VaultRecord } from '../idb';
import { keyCreationDate } from '../opaque-params';
import type {
	LoadAliasKeysArgs,
	LoadAliasKeysResponse,
	UnloadAliasKeysArgs,
	CreateAliasKeyArgs,
	CreateSigningDelegationKeyArgs,
	CreateSigningDelegationKeyResponse,
	CreateAliasKeyResponse,
	ReformatKeyWithUidsArgs,
	ReformatKeyWithUidsResponse,
	CommitReformattedKeyArgs,
	CommitReformattedKeyResponse,
	AbandonKeyRotationArgs,
	CommitKeyRotationArgs,
	CommitKeyRotationResponse,
	ListAccountKeysArgs,
	ListAccountKeysResponse,
	LoadAccountKeysArgs,
	LoadAccountKeysResponse,
	PrepareKeyRotationArgs,
	PrepareKeyRotationResponse
} from '../protocol';
import type { VaultState, AccountKeyEntry } from './state';
import {
	PENDING_LOGIN_TTL_MS,
	vaults,
	cachedRecords,
	pendingRotations,
	broadcast,
	fingerprintHexOf,
	recomputeAliasCurrent,
	storedAccountKeys,
	unlockAccountKey,
	persistAccountKeys,
	announceAccountKeys,
	makeCurrent,
	unwrapWithAccountKeys
} from './state';

export const MAX_ENDORSEMENTS = 16;

export async function handleLoadAliasKeys(args: LoadAliasKeysArgs): Promise<LoadAliasKeysResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	const loaded: string[] = [];
	const failed: { aliasId: string; keyVersion: number }[] = [];
	for (const g of args.grants) {
		const want = g.aliasKeyFingerprintHex.toLowerCase();
		const held = v.aliasKeys.get(want);
		if (held) {
			if (v.product === 'app') {
				held.aliasId = g.aliasId;
				held.addressId = g.addressId;
				held.email = g.email;
				held.keyVersion = g.keyVersion;
			}
			loaded.push(want);
			continue;
		}
		try {
			const data = await unwrapWithAccountKeys(v, g.wrappedPrivateKeyArmored, g.memberKeyFingerprintHex);
			if (data === null) {
				failed.push({ aliasId: g.aliasId, keyVersion: g.keyVersion });
				continue;
			}
			const privateKey = await openpgp.readPrivateKey({ armoredKey: data });
			const got = fingerprintHexOf(privateKey);
			if (got !== want) {
				failed.push({ aliasId: g.aliasId, keyVersion: g.keyVersion });
				continue;
			}
			v.aliasKeys.set(got, {
				aliasId: g.aliasId,
				addressId: g.addressId,
				email: g.email,
				keyVersion: g.keyVersion,
				fingerprintHex: got,
				privateKey
			});
			loaded.push(got);
		} catch (err) {
			console.warn('keystore: alias key unwrap failed', err);
			failed.push({ aliasId: g.aliasId, keyVersion: g.keyVersion });
		}
	}
	recomputeAliasCurrent(v);
	broadcast({
		type: 'aliasKeysChanged',
		accountId: args.accountId,
		fingerprints: [...v.aliasKeys.keys()]
	});
	return { ok: true, loaded, failed };
}

export function handleUnloadAliasKeys(args: UnloadAliasKeysArgs): void {
	const v = vaults.get(args.accountId);
	if (!v) return;
	v.aliasKeys.clear();
	v.aliasCurrent.clear();
	broadcast({ type: 'aliasKeysChanged', accountId: args.accountId, fingerprints: [] });
}

export async function handleCreateAliasKey(args: CreateAliasKeyArgs): Promise<CreateAliasKeyResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!args.recipients.length) {
		return { ok: false, code: 'no_recipients' };
	}
	let recipientKeys: { accountId: string; key: openpgp.Key }[];
	try {
		recipientKeys = await Promise.all(
			args.recipients.map(async (r) => ({
				accountId: r.accountId,
				key: await openpgp.readKey({ armoredKey: r.publicKeyArmored })
			}))
		);
	} catch (err) {
		console.warn('keystore: alias key invalid recipient', err);
		return { ok: false, code: 'invalid_recipient_key' };
	}
	try {
		const generated = await generateCurve25519Key({
			userIDs: [{ name: args.displayName, email: args.email }],
			date: keyCreationDate(Date.now() + (args.serverClockOffsetMs ?? 0))
		});
		const armoredPrivate = generated.privateKey.armor();
		const grants = [];
		for (const r of recipientKeys) {
			const message = await openpgp.createMessage({ text: armoredPrivate });
			const wrapped = await openpgp.encrypt({
				message,
				encryptionKeys: r.key,
				signingKeys: v.privateKey,
				format: 'armored'
			});
			grants.push({
				accountId: r.accountId,
				wrappedPrivateKeyArmored: wrapped as string,
				memberKeyFingerprintHex: fingerprintHexOf(r.key)
			});
		}
		return {
			ok: true,
			publicKeyArmored: generated.publicKey.armor(),
			keyFingerprintHex: fingerprintHexOf(generated.privateKey),
			grants
		};
	} catch (err) {
		console.warn('keystore: alias key generation failed', err);
		return { ok: false, code: 'unknown' };
	}
}

export async function handleCreateSigningDelegationKey(
	args: CreateSigningDelegationKeyArgs
): Promise<CreateSigningDelegationKeyResponse> {
	if (!vaults.get(args.accountId)) {
		return { ok: false, code: 'locked' };
	}
	const email = args.email.trim().toLowerCase();
	if (!email.includes('@')) {
		return { ok: false, code: 'invalid_address' };
	}
	try {
		const generated = await generateDelegationKey({
			email,
			validForDays: args.validForDays,
			now: Date.now() + (args.serverClockOffsetMs ?? 0)
		});
		return { ok: true, ...generated };
	} catch (err) {
		console.warn('keystore: delegation key generation failed', err);
		return { ok: false, code: 'unknown' };
	}
}

export const KEY_FINGERPRINT_HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface ListedAccountKey {
	keyVersion: number;
	fingerprintHex: string;
	armored: string;
	transitions: { previousKeyFingerprintHex: string; signature: Uint8Array }[];
}

export function validKeyList(args: LoadAccountKeysArgs): ListedAccountKey[] | null {
	const count = args.currentVersion;
	if (!Number.isSafeInteger(count) || count < 1 || !Array.isArray(args.keys) || args.keys.length !== count) {
		return null;
	}
	const listed: (ListedAccountKey | undefined)[] = new Array(count);
	const seen = new Set<string>();
	for (const k of args.keys) {
		if (!k || !Number.isSafeInteger(k.keyVersion) || k.keyVersion < 1 || k.keyVersion > count) return null;
		if (listed[k.keyVersion - 1] || k.isCurrent !== (k.keyVersion === count)) return null;
		const fingerprintHex = typeof k.fingerprintHex === 'string' ? k.fingerprintHex.toLowerCase() : '';
		if (!KEY_FINGERPRINT_HEX.test(fingerprintHex) || seen.has(fingerprintHex)) return null;
		if (typeof k.encryptedPrivateKeyArmored !== 'string') return null;
		if (!Array.isArray(k.transitions) || k.transitions.length > MAX_ENDORSEMENTS) return null;
		const transitions = [];
		for (const t of k.transitions) {
			const previous = typeof t?.previousKeyFingerprintHex === 'string' ? t.previousKeyFingerprintHex.toLowerCase() : '';
			if (!KEY_FINGERPRINT_HEX.test(previous) || previous === fingerprintHex) return null;
			if (!(t.signature instanceof Uint8Array)) return null;
			transitions.push({ previousKeyFingerprintHex: previous, signature: t.signature });
		}
		seen.add(fingerprintHex);
		listed[k.keyVersion - 1] = {
			keyVersion: k.keyVersion,
			fingerprintHex,
			armored: k.encryptedPrivateKeyArmored,
			transitions
		};
	}
	return listed as ListedAccountKey[];
}

export function listAgreesWithVault(
	v: VaultState,
	current: AccountKeyEntry,
	listed: ListedAccountKey[],
	byFingerprint: Map<string, ListedAccountKey>
): boolean {
	for (const entry of v.accountKeys.values()) {
		const same = byFingerprint.get(entry.fingerprintHex);
		if (entry.provisional) {
			if (!same && entry === current) return false;
			continue;
		}
		if (same && same.keyVersion !== entry.keyVersion) return false;
		const slot = listed[entry.keyVersion - 1];
		if (slot && slot.fingerprintHex !== entry.fingerprintHex) return false;
	}
	return true;
}

export async function endorsedBy(
	accountId: string,
	key: ListedAccountKey,
	previous: AccountKeyEntry
): Promise<boolean> {
	const transition = key.transitions.find((t) => t.previousKeyFingerprintHex === previous.fingerprintHex);
	if (!transition) return false;
	try {
		await verifyKeyTransition({
			accountId,
			newKeyFingerprint: key.fingerprintHex,
			previousKeyFingerprint: previous.fingerprintHex,
			signature: transition.signature,
			previousPublicKeyArmored: previous.privateKey.toPublic().armor()
		});
		return true;
	} catch {
		return false;
	}
}

function checkProductKeyList(v: VaultState, args: LoadAccountKeysArgs): LoadAccountKeysResponse {
	const listed = validKeyList(args);
	if (!listed) return { ok: false, code: 'key_list_invalid' };
	const currentFingerprintHex = fingerprintHexOf(v.privateKey);
	const loaded: string[] = [];
	const failed: number[] = [];
	for (const k of listed) {
		const held = v.accountKeys.get(k.fingerprintHex);
		if (held && held.keyVersion !== k.keyVersion) return { ok: false, code: 'key_list_invalid' };
		if (held) loaded.push(k.fingerprintHex);
		else failed.push(k.keyVersion);
	}
	announceAccountKeys(v, false);
	return { ok: true, loaded, failed, unverified: [], currentFingerprintHex, keyVersion: v.keyVersion, currentChanged: false };
}

export async function handleLoadAccountKeys(args: LoadAccountKeysArgs): Promise<LoadAccountKeysResponse> {
	const v = vaults.get(args.accountId);
	if (!v) return { ok: false, code: 'locked' };
	if (v.product === 'app') return checkProductKeyList(v, args);
	if (v.authScheme !== 'opaque_v1' || !v.keyPassword) return { ok: false, code: 'not_opaque' };
	const start = v.accountKeys.get(fingerprintHexOf(v.privateKey));
	if (!start) return { ok: false, code: 'not_opaque' };
	const listed = validKeyList(args);
	if (!listed) return { ok: false, code: 'key_list_invalid' };
	const byFingerprint = new Map(listed.map((k) => [k.fingerprintHex, k]));
	if (!listAgreesWithVault(v, start, listed, byFingerprint)) return { ok: false, code: 'key_list_invalid' };

	const startVersion = byFingerprint.get(start.fingerprintHex)?.keyVersion ?? start.keyVersion;
	const held = new Set<string>();
	for (const entry of v.accountKeys.values()) {
		const same = byFingerprint.get(entry.fingerprintHex);
		if (!entry.provisional || !same) continue;
		if (entry === start || same.keyVersion < startVersion) {
			entry.keyVersion = same.keyVersion;
			delete entry.provisional;
		} else {
			held.add(entry.fingerprintHex);
		}
	}

	const loaded: string[] = [];
	const failed: number[] = [];
	const unverified: number[] = [];
	const candidates = new Map<number, AccountKeyEntry>();
	for (const k of listed) {
		const mine = v.accountKeys.get(k.fingerprintHex);
		if (mine && held.has(k.fingerprintHex)) {
			candidates.set(k.keyVersion, {
				keyVersion: k.keyVersion,
				fingerprintHex: k.fingerprintHex,
				privateKey: mine.privateKey,
				armoredEncrypted: mine.armoredEncrypted
			});
			continue;
		}
		if (mine) {
			loaded.push(k.fingerprintHex);
			continue;
		}
		const unlocked = await unlockAccountKey(k.armored, v.keyPassword);
		if (!unlocked || unlocked.fingerprintHex !== k.fingerprintHex) {
			failed.push(k.keyVersion);
			continue;
		}
		candidates.set(k.keyVersion, {
			keyVersion: k.keyVersion,
			fingerprintHex: k.fingerprintHex,
			privateKey: unlocked.privateKey,
			armoredEncrypted: k.armored
		});
	}

	let trusted = start;
	for (let version = start.keyVersion + 1; version <= listed.length; version++) {
		const next = candidates.get(version);
		if (!next || !(await endorsedBy(v.accountId, listed[version - 1], trusted))) break;
		candidates.delete(version);
		v.accountKeys.set(next.fingerprintHex, next);
		loaded.push(next.fingerprintHex);
		trusted = next;
	}
	for (const [version, entry] of candidates) {
		if (version < trusted.keyVersion) {
			v.accountKeys.set(entry.fingerprintHex, entry);
			loaded.push(entry.fingerprintHex);
		} else {
			unverified.push(version);
		}
	}

	const currentChanged = trusted.fingerprintHex !== start.fingerprintHex;
	makeCurrent(v, trusted);
	await persistAccountKeys(v);
	announceAccountKeys(v, currentChanged);
	return {
		ok: true,
		loaded,
		failed,
		unverified: unverified.sort((a, b) => a - b),
		currentFingerprintHex: trusted.fingerprintHex,
		keyVersion: v.keyVersion,
		currentChanged
	};
}

export function handleListAccountKeys(args: ListAccountKeysArgs): ListAccountKeysResponse {
	const v = vaults.get(args.accountId);
	if (!v) return { ok: false, code: 'locked' };
	const currentFp = fingerprintHexOf(v.privateKey);
	return {
		ok: true,
		keyVersion: v.keyVersion,
		keys: [...v.accountKeys.values()]
			.sort((a, b) => b.keyVersion - a.keyVersion)
			.map((e) => ({
				fingerprintHex: e.fingerprintHex,
				keyVersion: e.keyVersion,
				isCurrent: e.fingerprintHex === currentFp
			}))
	};
}

export async function endorse(
	key: openpgp.PrivateKey,
	payload: Uint8Array,
	date: Date
): Promise<Uint8Array> {
	const signature = await openpgp.sign({
		message: await openpgp.createMessage({ binary: payload }),
		signingKeys: key,
		signingKeyIDs: key.getKeyID(),
		detached: true,
		format: 'binary',
		date
	});
	return signature as Uint8Array;
}

export async function handlePrepareKeyRotation(
	args: PrepareKeyRotationArgs
): Promise<PrepareKeyRotationResponse> {
	const v = vaults.get(args.accountId);
	if (!v) return { ok: false, code: 'locked' };
	if (v.authScheme !== 'opaque_v1' || !v.keyPassword) return { ok: false, code: 'not_opaque' };
	if (
		args.expectedKeyVersion !== v.keyVersion ||
		v.accountKeys.get(fingerprintHexOf(v.privateKey))?.provisional === true
	) {
		return { ok: false, code: 'stale_key_version' };
	}
	const { emails } = planUids(args.emails, []);
	if (emails.length === 0) return { ok: false, code: 'no_emails' };
	const required = [...v.accountKeys.values()]
		.sort((a, b) => b.keyVersion - a.keyVersion)
		.slice(0, MAX_ENDORSEMENTS);
	const versions = new Set(required.map((e) => e.keyVersion));
	for (let version = v.keyVersion; version > Math.max(0, v.keyVersion - MAX_ENDORSEMENTS); version--) {
		if (!versions.has(version)) return { ok: false, code: 'key_history_incomplete' };
	}
	try {
		const now = Date.now() + (args.serverClockOffsetMs ?? 0);
		const generated = await generateCurve25519Key({
			userIDs: emails.map((email) => ({ email })),
			date: keyCreationDate(now)
		});
		const fingerprintHex = fingerprintHexOf(generated.privateKey);
		if (v.accountKeys.has(fingerprintHex)) return { ok: false, code: 'unknown' };
		const locked = await lockKey(generated.privateKey, v.keyPassword);
		const armoredEncrypted = locked.armor();
		const publicKeyArmored = generated.publicKey.armor();
		const transitions = [];
		for (const entry of required) {
			const signature = await endorse(
				entry.privateKey,
				keyTransitionPayload(args.accountId, fingerprintHex, entry.fingerprintHex),
				new Date(now)
			);
			await verifyKeyTransition({
				accountId: args.accountId,
				newKeyFingerprint: fingerprintHex,
				previousKeyFingerprint: entry.fingerprintHex,
				signature,
				previousPublicKeyArmored: entry.privateKey.toPublic().armor()
			});
			transitions.push({ previousKeyFingerprintHex: entry.fingerprintHex, signature });
		}
		pendingRotations.set(args.accountId, {
			fingerprintHex,
			keyVersion: v.keyVersion + 1,
			privateKey: generated.privateKey,
			armoredEncrypted,
			expiresAt: Date.now() + PENDING_LOGIN_TTL_MS
		});
		return {
			ok: true,
			publicKeyArmored,
			encryptedPrivateKey: armoredEncrypted,
			fingerprintHex,
			keyVersion: v.keyVersion + 1,
			transitions
		};
	} catch (err) {
		console.warn('keystore: prepareKeyRotation failed', err);
		return { ok: false, code: 'unknown' };
	}
}

export async function handleCommitKeyRotation(
	args: CommitKeyRotationArgs
): Promise<CommitKeyRotationResponse> {
	const v = vaults.get(args.accountId);
	if (!v) return { ok: false, code: 'locked' };
	const pending = pendingRotations.get(args.accountId);
	if (
		!pending ||
		pending.expiresAt < Date.now() ||
		pending.fingerprintHex !== args.fingerprintHex.toLowerCase()
	) {
		return { ok: false, code: 'no_pending_rotation' };
	}
	pendingRotations.delete(args.accountId);
	const entry: AccountKeyEntry = {
		keyVersion: v.accountKeys.get(pending.fingerprintHex)?.keyVersion ?? pending.keyVersion,
		fingerprintHex: pending.fingerprintHex,
		privateKey: pending.privateKey,
		armoredEncrypted: pending.armoredEncrypted
	};
	v.accountKeys.set(entry.fingerprintHex, entry);
	makeCurrent(v, entry);
	await persistAccountKeys(v);
	announceAccountKeys(v, true);
	broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
	return { ok: true, keyVersion: v.keyVersion };
}

export function handleAbandonKeyRotation(args: AbandonKeyRotationArgs): void {
	pendingRotations.delete(args.accountId);
}
