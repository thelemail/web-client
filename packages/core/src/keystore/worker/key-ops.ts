/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import { generateDelegationKey } from '$core/keys/delegationKey';
import { generateCurve25519Key } from '$core/keys/pgpKeys';
import { keyCreationDate } from '../opaque-params';
import type {
	LoadAliasKeysArgs,
	LoadAliasKeysResponse,
	UnloadAliasKeysArgs,
	CreateAliasKeyArgs,
	CreateSigningDelegationKeyArgs,
	CreateSigningDelegationKeyResponse,
	CreateAliasKeyResponse
} from '../protocol';
import { vaults, broadcast, fingerprintHexOf, recomputeAliasCurrent, unwrapWithAccountKeys } from './state';

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

export * from './account-key-ops';
