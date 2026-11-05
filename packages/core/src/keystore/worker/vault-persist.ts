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
import type { VaultState } from './state';
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
export const HKDF_INFO_V2 = new TextEncoder().encode('thelemail-vault-wrap-v2');

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
	const v = vaults.get(args.accountId);
	if (!v) {
		throw new Error('keystore: cannot enroll persistent — vault is locked');
	}
	const ikm = crypto.getRandomValues(new Uint8Array(32));
	const localHalfKey = await crypto.subtle.importKey(
		'raw',
		ikm as BufferSource,
		'HKDF',
		false,
		['deriveKey']
	);
	ikm.fill(0);

	const wrapVersion: 1 | 2 = v.authScheme === 'opaque_v1' && v.masterKey ? 2 : 1;
	const serverHalfBytes = base64ToBytes(args.serverHalf);
	const wrapKey = await deriveWrapKey(localHalfKey, serverHalfBytes, wrapVersion);
	serverHalfBytes.fill(0);

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
		localHalfKey
	};
	await putVault(updated);
	cachedRecords.set(v.accountId, updated);
	v.wrapKey = wrapKey;
}

export async function handleTryRestoreFromPersistent(
	args: TryRestoreFromPersistentArgs
): Promise<RestoreResponse> {
	await restorePromise;
	const rec = cachedRecords.get(args.accountId) ?? (await getVault(args.accountId)) ?? undefined;
	if (rec) cachedRecords.set(rec.accountId, rec);
	if (!rec || !rec.localHalfKey || !rec.wrappedPrivateKey || !rec.wrapIv) {
		return { ok: false, reason: 'no_persistent' };
	}
	await ensureCryptoReady();
	const wrapVersion = rec.wrapPayloadVersion ?? 1;
	try {
		const serverHalfBytes = base64ToBytes(args.serverHalf);
		const wrapKey = await deriveWrapKey(rec.localHalfKey, serverHalfBytes, wrapVersion);
		serverHalfBytes.fill(0);

		const plaintext = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: rec.wrapIv as BufferSource },
			wrapKey,
			rec.wrappedPrivateKey as BufferSource
		);
		const decoded = new TextDecoder().decode(plaintext);

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
