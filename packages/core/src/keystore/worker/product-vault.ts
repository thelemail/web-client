/// <reference lib="webworker" />

import * as openpgp from 'openpgp';
import type { VaultRecord } from '../idb';
import { b64decode, b64encode, bytesEqual, isCanonicalUuid } from '../productkeys/encoding';
import { SECRET_LEN } from '../productkeys/envelope';
import { fail } from '../productkeys/errors';
import type { Product } from '../productkeys/productBundle';
import { ENTRY, isProduct } from '../productkeys/productBundle';
import type { AccountKeyEntry, AliasKeyEntry, VaultState } from './state';
import { fingerprintHexOf, recomputeAliasCurrent } from './state';

export const PRODUCT_VAULT_VERSION = 4;
export const PRODUCT_VAULT_WRAP_INFO = new TextEncoder().encode('thelemail-product-vault-wrap-v1');

const IDENTITY_PURPOSE: Record<Product, string> = {
	app: ENTRY.mailIdentity,
	calendar: ENTRY.calendarIdentity
};

export interface ProductVaultKey {
	keyId: string;
	scopeId: string;
	purpose: string;
	profileId: string;
	keyEpoch: number;
	material: Uint8Array;
	alias?: { aliasId: string; addressId: string; email: string };
}

export interface ProductVaultManifest {
	manifestId: string;
	revision: number;
	hash: Uint8Array;
	productKeyEpoch: number;
}

export interface ProductVault {
	product: Product;
	root: Uint8Array;
	currentKeyId: string | null;
	keys: ProductVaultKey[];
	manifest: ProductVaultManifest | null;
}

interface WireKey {
	i: string;
	s: string;
	u: string;
	f: string;
	e: number;
	m: string;
	a?: [string, string, string];
}

interface Wire {
	v: typeof PRODUCT_VAULT_VERSION;
	p: Product;
	r: string;
	c: string | null;
	k: WireKey[];
	n: { i: string; r: number; h: string; e: number } | null;
}

export function encodeProductVault(vault: ProductVault): Uint8Array {
	const wire: Wire = {
		v: PRODUCT_VAULT_VERSION,
		p: vault.product,
		r: b64encode(vault.root),
		c: vault.currentKeyId,
		k: vault.keys.map((k) => ({
			i: k.keyId,
			s: k.scopeId,
			u: k.purpose,
			f: k.profileId,
			e: k.keyEpoch,
			m: b64encode(k.material),
			...(k.alias ? { a: [k.alias.aliasId, k.alias.addressId, k.alias.email] as [string, string, string] } : {})
		})),
		n: vault.manifest
			? { i: vault.manifest.manifestId, r: vault.manifest.revision, h: b64encode(vault.manifest.hash), e: vault.manifest.productKeyEpoch }
			: null
	};
	return new TextEncoder().encode(JSON.stringify(wire));
}

function counter(n: unknown): number {
	if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 1) fail('malformed', 'product vault counter');
	return n;
}

function text(s: unknown): string {
	if (typeof s !== 'string') fail('malformed', 'product vault field');
	return s;
}

function decodeKey(raw: unknown, version: number): ProductVaultKey {
	if (!raw || typeof raw !== 'object') fail('malformed', 'product vault key');
	const k = raw as Partial<WireKey>;
	const material = b64decode(k.m);
	if (material.length === 0) fail('malformed', 'product vault key material');
	if (version < PRODUCT_VAULT_VERSION) {
		return { keyId: text(k.i), scopeId: '', purpose: text(k.u), profileId: '', keyEpoch: 1, material };
	}
	const out: ProductVaultKey = {
		keyId: text(k.i),
		scopeId: text(k.s),
		purpose: text(k.u),
		profileId: text(k.f),
		keyEpoch: counter(k.e),
		material
	};
	if (!isCanonicalUuid(out.keyId) || !isCanonicalUuid(out.scopeId)) fail('malformed', 'product vault key id');
	if (k.a !== undefined) {
		if (!Array.isArray(k.a) || k.a.length !== 3) fail('malformed', 'product vault alias');
		out.alias = { aliasId: text(k.a[0]), addressId: text(k.a[1]), email: text(k.a[2]) };
	}
	return out;
}

export function decodeProductVault(decoded: string): ProductVault {
	let raw: unknown;
	try {
		raw = JSON.parse(decoded);
	} catch {
		fail('malformed', 'product vault payload');
	}
	if (!raw || typeof raw !== 'object') fail('malformed', 'product vault payload');
	const w = raw as Partial<Wire> & { v?: unknown };
	const version = w.v === undefined ? 3 : w.v;
	if (version !== 3 && version !== PRODUCT_VAULT_VERSION) fail('malformed', 'product vault version');
	if (!isProduct(w.p) || !Array.isArray(w.k)) fail('malformed', 'product vault payload');
	const root = b64decode(w.r);
	if (root.length !== SECRET_LEN) fail('malformed', 'product vault root');
	const keys = w.k.map((k) => decodeKey(k, version));
	if (version === 3) return { product: w.p, root, currentKeyId: null, keys, manifest: null };
	const currentKeyId = w.c === null ? null : text(w.c);
	let manifest: ProductVaultManifest | null = null;
	if (w.n !== null && w.n !== undefined) {
		const hash = b64decode(w.n.h);
		if (hash.length !== 32 || !isCanonicalUuid(w.n.i)) fail('malformed', 'product vault manifest');
		manifest = { manifestId: w.n.i, revision: counter(w.n.r), hash, productKeyEpoch: counter(w.n.e) };
	}
	return { product: w.p, root, currentKeyId, keys, manifest };
}

export function wipeProductVault(vault: ProductVault): void {
	vault.root.fill(0);
	for (const k of vault.keys) k.material.fill(0);
}

export async function productVaultState(accountId: string, email: string, vault: ProductVault): Promise<VaultState> {
	const accountKeys = new Map<string, AccountKeyEntry>();
	const aliasKeys = new Map<string, AliasKeyEntry>();
	let current: AccountKeyEntry | null = null;
	let newest: AccountKeyEntry | null = null;
	let searchLeaf: Uint8Array | undefined;
	for (const k of vault.keys) {
		if (k.purpose === IDENTITY_PURPOSE[vault.product]) {
			const privateKey = await openpgp.readPrivateKey({ binaryKey: k.material.slice() });
			const entry: AccountKeyEntry = { keyVersion: k.keyEpoch, fingerprintHex: fingerprintHexOf(privateKey), privateKey, armoredEncrypted: '' };
			if (vault.product === 'app') accountKeys.set(entry.fingerprintHex, entry);
			if (k.keyId === vault.currentKeyId) current = entry;
			if (!newest || entry.keyVersion > newest.keyVersion) newest = entry;
		} else if (vault.product === 'app' && k.purpose === ENTRY.mailAlias) {
			const privateKey = await openpgp.readPrivateKey({ binaryKey: k.material.slice() });
			const fingerprintHex = fingerprintHexOf(privateKey);
			aliasKeys.set(fingerprintHex, {
				aliasId: k.alias?.aliasId ?? '',
				addressId: k.alias?.addressId ?? '',
				email: k.alias?.email ?? '',
				keyVersion: k.keyEpoch,
				fingerprintHex,
				privateKey
			});
		} else if (vault.product === 'app' && k.purpose === ENTRY.mailSearchIndex) {
			if (k.material.length !== SECRET_LEN) fail('malformed', 'search leaf length');
			searchLeaf = k.material.slice();
		}
	}
	if (vault.currentKeyId !== null && !current) fail('context', 'current identity key is not in the vault');
	const identity = current ?? newest;
	if (!identity) fail('context', 'no identity key for the product');
	const state: VaultState = {
		accountId,
		email,
		authScheme: 'opaque_v1',
		armoredEncryptedPrivateKey: '',
		privateKey: identity.privateKey,
		keyPassword: vault.product === 'app' ? '' : `${vault.product}:${accountId}`,
		accountKeys,
		keyVersion: vault.product === 'app' ? identity.keyVersion : 1,
		aliasKeys,
		aliasCurrent: new Map(),
		product: vault.product,
		...(searchLeaf ? { searchLeaf } : {})
	};
	recomputeAliasCurrent(state);
	return state;
}

export async function productWrapKey(localHalfKey: CryptoKey, serverHalf: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: serverHalf as BufferSource, info: PRODUCT_VAULT_WRAP_INFO as BufferSource },
		localHalfKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export async function sealProductRecord(accountId: string, email: string, vault: ProductVault, serverHalf: Uint8Array): Promise<{ record: VaultRecord; plain: Uint8Array }> {
	const ikm = crypto.getRandomValues(new Uint8Array(32));
	const localHalfKey = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveKey']);
	ikm.fill(0);
	const wrapKey = await productWrapKey(localHalfKey, serverHalf);
	const wrapIv = crypto.getRandomValues(new Uint8Array(12));
	const plain = encodeProductVault(vault);
	const wrappedPrivateKey = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv as BufferSource }, wrapKey, plain as BufferSource));
	return {
		record: {
			accountId,
			email,
			authScheme: 'opaque_v1',
			armoredEncryptedPrivateKey: '',
			updatedAt: Date.now(),
			wrappedPrivateKey,
			wrapIv,
			wrapPayloadVersion: PRODUCT_VAULT_VERSION,
			localHalfKey
		},
		plain
	};
}

export async function reopenProductRecord(record: VaultRecord | null | undefined, serverHalf: Uint8Array, plain: Uint8Array): Promise<CryptoKey> {
	if (!record?.localHalfKey || !record.wrappedPrivateKey || !record.wrapIv) fail('context', 'staged vault did not read back');
	const wrapKey = await productWrapKey(record.localHalfKey, serverHalf);
	let reread: Uint8Array;
	try {
		reread = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.wrapIv as BufferSource }, wrapKey, record.wrappedPrivateKey as BufferSource));
	} catch {
		fail('context', 'staged vault did not read back');
	}
	const same = bytesEqual(reread, plain);
	reread.fill(0);
	if (!same) fail('context', 'staged vault did not read back');
	return wrapKey;
}
