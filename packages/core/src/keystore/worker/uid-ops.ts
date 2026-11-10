/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { lockKey, reformatWithUserIDs, selfSignaturesPostdateCreation } from '$core/keys/pgpKeys';
import { planUids } from '$core/keys/uidPlan';
import { putVault } from '../idb';
import type { VaultRecord } from '../idb';
import type { CommitReformattedKeyArgs, CommitReformattedKeyResponse, ReformatKeyWithUidsArgs, ReformatKeyWithUidsResponse } from '../protocol';
import { broadcast, cachedRecords, fingerprintHexOf, storedAccountKeys, vaults } from './state';

export async function handleReformatKeyWithUids(
	args: ReformatKeyWithUidsArgs
): Promise<ReformatKeyWithUidsResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!v.keyPassword) {
		return { ok: false, code: 'no_key_password' };
	}
	const currentUids = v.privateKey.users
		.map((u) => u.userID?.userID ?? '')
		.filter((s) => s.length > 0);
	const { emails, unchanged } = planUids(args.emails, currentUids);
	if (emails.length === 0) {
		return { ok: false, code: 'no_emails' };
	}
	try {
		if (unchanged && !selfSignaturesPostdateCreation(v.privateKey)) {
			return { ok: true, unchanged: true };
		}

		const originalFingerprint = v.privateKey.getFingerprint();
		const { privateKey: reformatted } = await reformatWithUserIDs(
			v.privateKey,
			emails.map((email) => ({ email }))
		);
		if (reformatted.getFingerprint() !== originalFingerprint) {
			return { ok: false, code: 'fingerprint_changed' };
		}
		try {
			await reformatted.getSigningKey();
			await reformatted.getEncryptionKey();
		} catch {
			return { ok: false, code: 'unusable_key' };
		}
		const encrypted = await lockKey(reformatted, v.keyPassword);
		const encryptedPrivateKey = encrypted.armor();
		const publicKeyArmored = reformatted.toPublic().armor();
		return { ok: true, unchanged: false, publicKeyArmored, encryptedPrivateKey };
	} catch (err) {
		console.warn('keystore: reformatKeyWithUids failed', err);
		return { ok: false, code: 'unknown' };
	}
}

export async function handleCommitReformattedKey(
	args: CommitReformattedKeyArgs
): Promise<CommitReformattedKeyResponse> {
	const v = vaults.get(args.accountId);
	if (!v) {
		return { ok: false, code: 'locked' };
	}
	if (!v.keyPassword) {
		return { ok: false, code: 'no_key_password' };
	}
	try {
		const encrypted = (await openpgp.readPrivateKey({
			armoredKey: args.encryptedPrivateKey
		})) as openpgp.PrivateKey;
		const unlocked = await openpgp.decryptKey({
			privateKey: encrypted,
			passphrase: v.keyPassword
		});
		if (unlocked.getFingerprint() !== v.privateKey.getFingerprint()) {
			return { ok: false, code: 'invalid' };
		}

		v.privateKey = unlocked;
		v.armoredEncryptedPrivateKey = args.encryptedPrivateKey;
		const currentFp = fingerprintHexOf(unlocked);
		const entry = v.accountKeys.get(currentFp);
		v.accountKeys.set(currentFp, {
			keyVersion: entry?.keyVersion ?? v.keyVersion,
			fingerprintHex: currentFp,
			privateKey: unlocked,
			armoredEncrypted: args.encryptedPrivateKey
		});

		const prev = cachedRecords.get(args.accountId);
		if (prev) {
			let wrappedPrivateKey = prev.wrappedPrivateKey;
			let wrapIv = prev.wrapIv;
			if (v.wrapKey && prev.wrappedPrivateKey && (prev.wrapPayloadVersion ?? 1) === 1) {
				const payload = JSON.stringify({ k: unlocked.armor(), p: v.keyPassword });
				const iv = crypto.getRandomValues(new Uint8Array(12));
				wrappedPrivateKey = new Uint8Array(
					await crypto.subtle.encrypt(
						{ name: 'AES-GCM', iv: iv as BufferSource },
						v.wrapKey,
						new TextEncoder().encode(payload) as BufferSource
					)
				);
				wrapIv = iv;
			}
			const updated: VaultRecord = {
				...prev,
				armoredEncryptedPrivateKey: args.encryptedPrivateKey,
				...storedAccountKeys(v),
				wrappedPrivateKey,
				wrapIv,
				updatedAt: Date.now()
			};
			await putVault(updated);
			cachedRecords.set(args.accountId, updated);
		}
		broadcast({ type: 'vaultChanged', accountId: v.accountId, email: v.email });
		return { ok: true };
	} catch (err) {
		console.warn('keystore: commitReformattedKey failed', err);
		return { ok: false, code: 'invalid' };
	}
}
