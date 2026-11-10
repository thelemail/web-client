/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { deleteVault, getVault, putVault } from '../idb';
import type { VaultRecord } from '../idb';
import {
	base64ToBytes as opaqueBase64ToBytes,
	bytesToBase64 as opaqueBytesToBase64,
	derivePgpPassphrase
} from '../opaque-params';
import type {
	DisablePersistentArgs,
	EnrollPersistentArgs,
	InvalidatePersistedVaultArgs,
	RestoreResponse,
	TryRestoreFromPersistentArgs
} from '../protocol';
import { isAuthOrigin } from '../../products';
import { AUTH_VAULT_WRAP_INFO, LOCAL_KEY_UNSTORABLE, WRAP_KEY_BYTES } from '../vault-wrap';
import type { VaultState } from './state';
import { restoreProductVault } from './handoff-ops';
import { productWrapKey } from './product-vault';
import {
	vaults,
	cachedRecords,
	restorePromise,
	ensureCryptoReady,
	broadcast,
	base64ToBytes,
	storedAccountKeys,
	seedAccountKeys
} from './state';

export async function handleInvalidatePersistedVault(args: InvalidatePersistedVaultArgs): Promise<void> {
	cachedRecords.delete(args.accountId);
	try {
		await deleteVault(args.accountId);
	} catch (err) {
		console.warn('keystore: invalidatePersistedVault failed', err);
	}
	broadcast({ type: 'persistentDisabled', accountId: args.accountId });
}

export const HKDF_INFO_V1 = new TextEncoder().encode('thelemail-vault-wrap-v1');
export const HKDF_INFO_V2 = new TextEncoder().encode(
	isAuthOrigin ? AUTH_VAULT_WRAP_INFO : 'thelemail-vault-wrap-v2'
);

function takeWrapKey(buf: ArrayBuffer | undefined): Uint8Array | null {
	if (!buf) return null;
	return new Uint8Array(buf);
}

async function importWrapKey(bytes: Uint8Array): Promise<CryptoKey> {
	try {
		if (bytes.byteLength !== WRAP_KEY_BYTES) {
			throw new Error('keystore: wrap key has the wrong length');
		}
		return await crypto.subtle.importKey(
			'raw',
			bytes as BufferSource,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt']
		);
	} finally {
		bytes.fill(0);
	}
}

function isDataCloneError(err: unknown): boolean {
	return err instanceof DOMException && err.name === 'DataCloneError';
}

export async function deriveWrapKey(
	localHalfKey: CryptoKey,
	serverHalf: Uint8Array,
	wrapVersion: 1 | 2 = 1
): Promise<CryptoKey> {
	const info = wrapVersion === 2 ? HKDF_INFO_V2 : HKDF_INFO_V1;
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: serverHalf as BufferSource, info: info as BufferSource },
		localHalfKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function handleEnrollPersistent(args: EnrollPersistentArgs): Promise<void> {
	const pageWrapKey = takeWrapKey(args.wrapKey);
	const v = vaults.get(args.accountId);
	if (!v) {
		pageWrapKey?.fill(0);
		throw new Error('keystore: cannot enroll persistent — vault is locked');
	}
	const wrapVersion: 1 | 2 = v.authScheme === 'opaque_v1' && v.masterKey ? 2 : 1;
	if (isAuthOrigin && wrapVersion !== 2) {
		pageWrapKey?.fill(0);
		throw new Error('keystore: the auth vault persists only an OPAQUE master key');
	}
	if (pageWrapKey && !isAuthOrigin) {
		pageWrapKey.fill(0);
		throw new Error('keystore: a page-held local key is only accepted on the auth origin');
	}

	let localHalfKey: CryptoKey | undefined;
	let wrapKey: CryptoKey;
	if (pageWrapKey) {
		wrapKey = await importWrapKey(pageWrapKey);
	} else {
		const ikm = crypto.getRandomValues(new Uint8Array(32));
		localHalfKey = await crypto.subtle.importKey(
			'raw',
			ikm as BufferSource,
			'HKDF',
			false,
			['deriveKey']
		);
		ikm.fill(0);
		const serverHalfBytes = base64ToBytes(args.serverHalf);
		wrapKey = await deriveWrapKey(localHalfKey, serverHalfBytes, wrapVersion);
		serverHalfBytes.fill(0);
	}

	const wrappedPayload =
		wrapVersion === 2
			? JSON.stringify({ m: opaqueBytesToBase64(v.masterKey as Uint8Array) })
			: JSON.stringify({ k: v.privateKey.armor(), p: v.keyPassword });
	const wrapIv = crypto.getRandomValues(new Uint8Array(12));
	const wrappedPrivateKey = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv: wrapIv as BufferSource },
			wrapKey,
			new TextEncoder().encode(wrappedPayload) as BufferSource
		)
	);

	const updated: VaultRecord = {
		accountId: v.accountId,
		email: v.email,
		authScheme: v.authScheme,
		srpSalt: v.srpSalt,
		keySalt: v.keySalt,
		wrappedMasterKey: v.wrappedMasterKey,
		masterKeyId: v.masterKeyId,
		opaqueParamsVersion: v.opaqueParamsVersion,
		armoredEncryptedPrivateKey: v.armoredEncryptedPrivateKey,
		...storedAccountKeys(v),
		updatedAt: Date.now(),
		wrappedPrivateKey,
		wrapIv,
		wrapPayloadVersion: wrapVersion,
		...(localHalfKey ? { localHalfKey } : { localHalfHolder: 'page' as const })
	};
	try {
		await putVault(updated);
	} catch (err) {
		if (isAuthOrigin && localHalfKey && isDataCloneError(err)) {
			throw new Error(LOCAL_KEY_UNSTORABLE);
		}
		throw err;
	}
	cachedRecords.set(v.accountId, updated);
	v.wrapKey = wrapKey;
}

export async function handleTryRestoreFromPersistent(
	args: TryRestoreFromPersistentArgs
): Promise<RestoreResponse> {
	const pageWrapKey = takeWrapKey(args.wrapKey);
	try {
		return await restoreFromRecord(args, pageWrapKey);
	} finally {
		pageWrapKey?.fill(0);
	}
}

async function restoreFromRecord(
	args: TryRestoreFromPersistentArgs,
	pageWrapKey: Uint8Array | null
): Promise<RestoreResponse> {
	await restorePromise;
	const rec = cachedRecords.get(args.accountId) ?? (await getVault(args.accountId)) ?? undefined;
	if (rec) cachedRecords.set(rec.accountId, rec);
	const pageHeld = rec?.localHalfHolder === 'page';
	if (!rec || !rec.wrappedPrivateKey || !rec.wrapIv || (!rec.localHalfKey && !pageHeld)) {
		return { ok: false, reason: 'no_persistent' };
	}
	if (pageHeld && (!isAuthOrigin || !pageWrapKey)) {
		return { ok: false, reason: 'no_persistent' };
	}
	await ensureCryptoReady();
	const wrapVersion = rec.wrapPayloadVersion ?? 1;
	if (isAuthOrigin && wrapVersion !== 2) {
		return { ok: false, reason: 'no_persistent' };
	}
	try {
		let wrapKey: CryptoKey;
		if (pageHeld && pageWrapKey) {
			wrapKey = await importWrapKey(pageWrapKey);
		} else {
			const serverHalfBytes = base64ToBytes(args.serverHalf);
			wrapKey =
				wrapVersion >= 3
					? await productWrapKey(rec.localHalfKey as CryptoKey, serverHalfBytes)
					: await deriveWrapKey(rec.localHalfKey as CryptoKey, serverHalfBytes, wrapVersion === 2 ? 2 : 1);
			serverHalfBytes.fill(0);
		}

		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: rec.wrapIv as BufferSource },
			wrapKey,
			rec.wrappedPrivateKey as BufferSource
		);
		const decoded = new TextDecoder().decode(plaintext);

		if (wrapVersion >= 3) {
			if (isAuthOrigin) return { ok: false, reason: 'no_persistent' };
			const v = await restoreProductVault(rec, wrapKey, decoded);
			vaults.set(rec.accountId, v);
			broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
			return { ok: true, accountId: v.accountId, email: v.email };
		}

		if (wrapVersion === 2) {
			const parsed = JSON.parse(decoded);
			const masterKey = opaqueBase64ToBytes(parsed.m as string);
			const keyPassword = await derivePgpPassphrase(masterKey);
			const privateKey = await openpgp.readPrivateKey({
				armoredKey: rec.armoredEncryptedPrivateKey
			});
			const unlocked = await openpgp.decryptKey({ privateKey, passphrase: keyPassword });

			const v: VaultState = {
				accountId: rec.accountId,
				email: rec.email,
				authScheme: 'opaque_v1',
				wrappedMasterKey: rec.wrappedMasterKey,
				masterKeyId: rec.masterKeyId,
				opaqueParamsVersion: rec.opaqueParamsVersion,
				masterKey,
				armoredEncryptedPrivateKey: rec.armoredEncryptedPrivateKey,
				privateKey: unlocked,
				keyPassword,
				wrapKey,
				accountKeys: new Map(),
				keyVersion: 1,
				aliasKeys: new Map(),
				aliasCurrent: new Map()
			};
			await seedAccountKeys(v, rec);
			vaults.set(rec.accountId, v);
			broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
			return { ok: true, accountId: v.accountId, email: v.email };
		}

		let armored = decoded;
		let keyPassword = '';
		try {
			const parsed = JSON.parse(decoded);
			if (parsed && typeof parsed.k === 'string') {
				armored = parsed.k;
				keyPassword = typeof parsed.p === 'string' ? parsed.p : '';
			}
		} catch {
			armored = decoded;
		}
		const privateKey = (await openpgp.readPrivateKey({
			armoredKey: armored
		})) as openpgp.PrivateKey;

		const v: VaultState = {
			accountId: rec.accountId,
			email: rec.email,
			authScheme: 'srp_v1',
			srpSalt: rec.srpSalt,
			keySalt: rec.keySalt,
			armoredEncryptedPrivateKey: rec.armoredEncryptedPrivateKey,
			privateKey,
			keyPassword,
			wrapKey,
			accountKeys: new Map(),
			keyVersion: 1,
			aliasKeys: new Map(),
			aliasCurrent: new Map()
		};
		await seedAccountKeys(v);
		vaults.set(rec.accountId, v);
		broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
		return { ok: true, accountId: v.accountId, email: v.email };
	} catch (err) {
		console.warn('keystore: tryRestoreFromPersistent failed', err);
		return { ok: false, reason: 'unwrap_failed' };
	}
}

export async function handleDisablePersistent(args: DisablePersistentArgs): Promise<void> {
	const rec = cachedRecords.get(args.accountId);
	if (!rec) return;
	const updated: VaultRecord = {
		accountId: rec.accountId,
		email: rec.email,
		authScheme: rec.authScheme,
		srpSalt: rec.srpSalt,
		keySalt: rec.keySalt,
		wrappedMasterKey: rec.wrappedMasterKey,
		masterKeyId: rec.masterKeyId,
		opaqueParamsVersion: rec.opaqueParamsVersion,
		armoredEncryptedPrivateKey: rec.armoredEncryptedPrivateKey,
		accountKeys: rec.accountKeys,
		keyVersion: rec.keyVersion,
		updatedAt: Date.now()
	};
	await putVault(updated);
	cachedRecords.set(rec.accountId, updated);
	broadcast({ type: 'persistentDisabled', accountId: rec.accountId });
}
