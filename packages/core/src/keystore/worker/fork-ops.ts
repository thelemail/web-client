/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import {
	base64ToBytes as opaqueBase64ToBytes,
	base64UrlToBytes,
	bytesToBase64 as opaqueBytesToBase64,
	bytesToBase64Url
} from '../opaque-params';
import type {
	SealProductForkArgs,
	SealProductForkResponse,
	OpenProductForkArgs,
	OpenProductForkResponse
} from '../protocol';
import type { VaultState, AliasKeyEntry } from './state';
import {
	vaults,
	indexKeys,
	broadcast,
	fingerprintHexOf,
	recomputeAliasCurrent,
	unwrapWithAccountKeys
} from './state';

export const FORK_PAYLOAD_VERSION = 1;

export interface ForkPayload {
	v: number;
	product: string;
	accountId: string;
	email: string;
	keys: {
		aliasId: string;
		addressId: string;
		email: string;
		keyVersion: number;
		fingerprintHex: string;
		privateKeyArmored: string;
	}[];
}

export function forkAad(product: string, accountId: string): BufferSource {
	return new TextEncoder().encode(`${product}:${accountId}`) as BufferSource;
}

export async function forkKey(raw: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
		'encrypt',
		'decrypt'
	]);
}

export async function handleSealProductFork(args: SealProductForkArgs): Promise<SealProductForkResponse> {
	const v = vaults.get(args.accountId);
	if (!v) return { ok: false, code: 'locked' };

	const keys: ForkPayload['keys'] = [];
	for (const g of args.grants) {
		try {
			const data = await unwrapWithAccountKeys(v, g.wrappedPrivateKeyArmored, g.memberKeyFingerprintHex);
			if (data === null) continue;
			const privateKey = await openpgp.readPrivateKey({ armoredKey: data });
			const got = fingerprintHexOf(privateKey);
			if (got !== g.aliasKeyFingerprintHex.toLowerCase()) continue;
			keys.push({
				aliasId: g.aliasId,
				addressId: g.addressId,
				email: g.email,
				keyVersion: g.keyVersion,
				fingerprintHex: got,
				privateKeyArmored: data
			});
		} catch (err) {
			console.warn('keystore: fork key unwrap failed', err);
		}
	}
	if (!keys.length) return { ok: false, code: 'no_keys' };

	const payload: ForkPayload = {
		v: FORK_PAYLOAD_VERSION,
		product: args.product,
		accountId: args.accountId,
		email: v.email,
		keys
	};
	const raw = crypto.getRandomValues(new Uint8Array(32));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await forkKey(raw);
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv: iv as BufferSource,
				additionalData: forkAad(args.product, args.accountId)
			},
			key,
			new TextEncoder().encode(JSON.stringify(payload)) as BufferSource
		)
	);
	const joined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
	joined.set(iv, 0);
	joined.set(ciphertext, iv.byteLength);
	const out = { ok: true as const, payload: opaqueBytesToBase64(joined), key: bytesToBase64Url(raw) };
	raw.fill(0);
	return out;
}

export async function handleOpenProductFork(args: OpenProductForkArgs): Promise<OpenProductForkResponse> {
	let payload: ForkPayload;
	const raw = base64UrlToBytes(args.key);
	try {
		const joined = opaqueBase64ToBytes(args.payload);
		const iv = joined.subarray(0, 12);
		const ciphertext = joined.subarray(12);
		const key = await forkKey(raw);
		const plaintext = new Uint8Array(
			await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: iv as BufferSource,
					additionalData: forkAad(args.product, args.accountId)
				},
				key,
				ciphertext as BufferSource
			)
		);
		payload = JSON.parse(new TextDecoder().decode(plaintext)) as ForkPayload;
	} catch (err) {
		console.warn('keystore: fork open failed', err);
		return { ok: false, code: 'invalid_payload' };
	} finally {
		raw.fill(0);
	}
	if (payload.v !== FORK_PAYLOAD_VERSION) return { ok: false, code: 'invalid_payload' };
	if (payload.product !== args.product) return { ok: false, code: 'wrong_product' };
	if (payload.accountId !== args.accountId) return { ok: false, code: 'wrong_account' };
	if (!payload.keys.length) return { ok: false, code: 'invalid_payload' };

	const aliasKeys = new Map<string, AliasKeyEntry>();
	let primary: openpgp.PrivateKey | null = null;
	for (const k of payload.keys) {
		try {
			const privateKey = await openpgp.readPrivateKey({ armoredKey: k.privateKeyArmored });
			if (fingerprintHexOf(privateKey) !== k.fingerprintHex) continue;
			aliasKeys.set(k.fingerprintHex, {
				aliasId: k.aliasId,
				addressId: k.addressId,
				email: k.email,
				keyVersion: k.keyVersion,
				fingerprintHex: k.fingerprintHex,
				privateKey
			});
			if (!primary) primary = privateKey;
		} catch (err) {
			console.warn('keystore: fork key import failed', err);
		}
	}
	if (!primary) return { ok: false, code: 'invalid_payload' };

	const state: VaultState = {
		accountId: args.accountId,
		email: payload.email,
		authScheme: 'opaque_v1',
		armoredEncryptedPrivateKey: '',
		privateKey: primary,
		keyPassword: `${args.product}:${args.accountId}`,
		accountKeys: new Map(),
		keyVersion: 1,
		aliasKeys,
		aliasCurrent: new Map()
	};
	recomputeAliasCurrent(state);
	vaults.set(args.accountId, state);
	indexKeys.delete(args.accountId);
	broadcast({ type: 'vaultChanged', accountId: args.accountId, email: payload.email });
	return { ok: true, accountId: args.accountId, email: payload.email, keyCount: aliasKeys.size };
}
