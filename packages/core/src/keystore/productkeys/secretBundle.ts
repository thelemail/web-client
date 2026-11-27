import type { Json } from './canonical';
import { decodeCanonical, encodeCanonical, parseJson } from './canonical';
import { b64encode, bytesEqual, requireUuid } from './encoding';
import { SECRET_LEN } from './envelope';
import { fail, ProductKeysError } from './errors';
import type { Obj } from './fields';
import { bin, exact, hash, id, int, MAX_RECORD_BYTES, str } from './fields';
import type { Product } from './productBundle';
import { isProduct } from './productBundle';
import { PROFILE } from './profiles';
import { openBundle, parseBundle, sealBundle } from '../secretwrap/secretwrap';

const ROOT_TYPE = 'thelemail-product-root/v1';
const AUTHORITY_TYPE = 'thelemail-account-authority/v1';
const ROOT_CANDIDATE_TYPE = 'thelemail-product-root-candidate/v1';
const ROOT_FIELDS = ['accountId', 'amkEpoch', 'bundleId', 'identityManifestHash', 'identityManifestId', 'identityManifestRevision', 'product', 'productKeyEpoch', 'productRoot', 'revision', 'type'];
const ROOT_CANDIDATE_FIELDS = ['accountId', 'amkEpoch', 'bundleId', 'bundlesHash', 'product', 'productKeyEpoch', 'productRoot', 'revision', 'type'];
const AUTHORITY_FIELDS = ['accountId', 'amkEpoch', 'authorityEpoch', 'authorityKeyId', 'bundleId', 'profileId', 'revision', 'secretKey', 'type'];

export interface SecretBundleHeader {
	accountId: string;
	amkEpoch: number;
	bundleId: string;
	revision: number;
}

export interface RootDescriptor {
	product: Product;
	productKeyEpoch: number;
	productRoot: Uint8Array;
	identityManifestId: string;
	identityManifestRevision: number;
	identityManifestHash: Uint8Array;
}

export interface RootCandidate {
	product: Product;
	productKeyEpoch: number;
	productRoot: Uint8Array;
	bundlesHash: Uint8Array;
}

export interface Authority {
	authorityKeyId: string;
	authorityEpoch: number;
	profileId: string;
	secretKey: Uint8Array;
}

function contextJson(h: SecretBundleHeader): Obj {
	return { accountId: h.accountId, bundleId: h.bundleId, revision: h.revision, amkEpoch: h.amkEpoch };
}

async function asBundleError<T>(f: () => Promise<T>): Promise<T> {
	try {
		return await f();
	} catch (err) {
		if (err instanceof ProductKeysError && err.code === 'purpose') fail('malformed', err.message);
		throw err;
	}
}

async function sealSecret(amk: Uint8Array, h: SecretBundleHeader, plain: Uint8Array): Promise<Uint8Array> {
	return asBundleError(() => sealBundle(amk, h, plain));
}

export async function sealRootDescriptor(amk: Uint8Array, h: SecretBundleHeader, d: RootDescriptor): Promise<Uint8Array> {
	checkRoot(d, amk);
	return sealSecret(
		amk,
		h,
		encodeCanonical({
			type: ROOT_TYPE,
			...contextJson(h),
			product: d.product,
			productKeyEpoch: d.productKeyEpoch,
			productRoot: b64encode(d.productRoot),
			identityManifestId: d.identityManifestId,
			identityManifestRevision: d.identityManifestRevision,
			identityManifestHash: b64encode(d.identityManifestHash)
		})
	);
}

export async function sealAuthority(amk: Uint8Array, h: SecretBundleHeader, a: Authority): Promise<Uint8Array> {
	checkAuthority(a, amk);
	return sealSecret(
		amk,
		h,
		encodeCanonical({
			type: AUTHORITY_TYPE,
			...contextJson(h),
			authorityKeyId: a.authorityKeyId,
			authorityEpoch: a.authorityEpoch,
			profileId: a.profileId,
			secretKey: b64encode(a.secretKey)
		})
	);
}

function checkRoot(d: RootDescriptor, amk: Uint8Array): void {
	if (!isProduct(d.product)) fail('malformed', 'product');
	requireUuid(d.identityManifestId);
	if (!Number.isSafeInteger(d.productKeyEpoch) || d.productKeyEpoch < 1) fail('malformed', 'productKeyEpoch');
	if (!Number.isSafeInteger(d.identityManifestRevision) || d.identityManifestRevision < 1) fail('malformed', 'identityManifestRevision');
	if (d.identityManifestHash.length !== 32) fail('malformed', 'identityManifestHash');
	if (d.productRoot.length !== SECRET_LEN) fail('malformed', 'product root length');
	if (bytesEqual(d.productRoot, amk)) fail('forbidden', 'product root equals the amk');
}

function checkAuthority(a: Authority, amk: Uint8Array): void {
	requireUuid(a.authorityKeyId);
	if (a.profileId !== PROFILE.accountAuthority || a.secretKey.length === 0) fail('malformed', 'authority');
	if (!Number.isSafeInteger(a.authorityEpoch) || a.authorityEpoch < 1) fail('malformed', 'authorityEpoch');
	if (bytesEqual(a.secretKey, amk)) fail('forbidden', 'authority key equals the amk');
}

export function parseSecretBundle(raw: Uint8Array): SecretBundleHeader {
	try {
		return parseBundle(raw);
	} catch (err) {
		if (err instanceof ProductKeysError && err.code === 'purpose') fail('malformed', err.message);
		throw err;
	}
}

async function openSecret(amk: Uint8Array, raw: Uint8Array, expect: SecretBundleHeader, type: string): Promise<Obj> {
	const plain = await asBundleError(() => openBundle(amk, raw, expect));
	const peek = parseJson(new TextDecoder().decode(plain)) as Json;
	if (peek === null || typeof peek !== 'object' || Array.isArray(peek) || peek.type !== type) fail('context');
	const o = decodeCanonical(plain, MAX_RECORD_BYTES);
	if (o.accountId !== expect.accountId || o.bundleId !== expect.bundleId || o.revision !== expect.revision || o.amkEpoch !== expect.amkEpoch) {
		fail('context');
	}
	return o;
}

export async function openRootDescriptor(amk: Uint8Array, raw: Uint8Array, expect: SecretBundleHeader): Promise<RootDescriptor> {
	const o = exact(await openSecret(amk, raw, expect, ROOT_TYPE), ROOT_FIELDS);
	const product = str(o, 'product');
	if (!isProduct(product)) fail('malformed', 'product');
	const d: RootDescriptor = {
		product,
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		productRoot: bin(o, 'productRoot', SECRET_LEN),
		identityManifestId: id(o, 'identityManifestId'),
		identityManifestRevision: int(o, 'identityManifestRevision', 1),
		identityManifestHash: hash(o, 'identityManifestHash')
	};
	checkRoot(d, amk);
	return d;
}

export async function openAuthority(amk: Uint8Array, raw: Uint8Array, expect: SecretBundleHeader): Promise<Authority> {
	const o = exact(await openSecret(amk, raw, expect, AUTHORITY_TYPE), AUTHORITY_FIELDS);
	const a: Authority = {
		authorityKeyId: id(o, 'authorityKeyId'),
		authorityEpoch: int(o, 'authorityEpoch', 1),
		profileId: str(o, 'profileId'),
		secretKey: bin(o, 'secretKey')
	};
	checkAuthority(a, amk);
	return a;
}

function checkRootCandidate(c: RootCandidate, amk: Uint8Array): void {
	if (!isProduct(c.product)) fail('malformed', 'product');
	if (!Number.isSafeInteger(c.productKeyEpoch) || c.productKeyEpoch < 1) fail('malformed', 'productKeyEpoch');
	if (c.bundlesHash.length !== 32) fail('malformed', 'bundlesHash');
	if (c.productRoot.length !== SECRET_LEN) fail('malformed', 'product root length');
	if (bytesEqual(c.productRoot, amk)) fail('forbidden', 'product root equals the amk');
}

export async function sealRootCandidate(amk: Uint8Array, h: SecretBundleHeader, c: RootCandidate): Promise<Uint8Array> {
	checkRootCandidate(c, amk);
	return sealSecret(
		amk,
		h,
		encodeCanonical({
			type: ROOT_CANDIDATE_TYPE,
			...contextJson(h),
			product: c.product,
			productKeyEpoch: c.productKeyEpoch,
			productRoot: b64encode(c.productRoot),
			bundlesHash: b64encode(c.bundlesHash)
		})
	);
}

export async function openRootCandidate(amk: Uint8Array, raw: Uint8Array, expect: SecretBundleHeader): Promise<RootCandidate> {
	const o = exact(await openSecret(amk, raw, expect, ROOT_CANDIDATE_TYPE), ROOT_CANDIDATE_FIELDS);
	const product = str(o, 'product');
	if (!isProduct(product)) fail('malformed', 'product');
	const c: RootCandidate = {
		product,
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		productRoot: bin(o, 'productRoot', SECRET_LEN),
		bundlesHash: hash(o, 'bundlesHash')
	};
	checkRootCandidate(c, amk);
	return c;
}
