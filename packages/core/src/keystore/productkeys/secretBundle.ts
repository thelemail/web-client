import type { Json } from './canonical';
import { decodeCanonical, encodeCanonical, parseJson } from './canonical';
import { b64encode, bytesEqual, requireUuid } from './encoding';
import { checkCipher, open, randomBytes, seal, AEAD, KDF, NONCE_LEN, SALT_LEN, SECRET_LEN } from './envelope';
import { fail } from './errors';
import type { Obj } from './fields';
import { bin, exact, hash, id, int, MAX_RECORD_BYTES, str } from './fields';
import type { Product } from './productBundle';
import { isProduct } from './productBundle';
import { PROFILE } from './profiles';

const INFO = 'thelemail/secret-wrap/v2/secret-bundle';
const ROOT_TYPE = 'thelemail-product-root/v1';
const AUTHORITY_TYPE = 'thelemail-account-authority/v1';
const ENVELOPE_FIELDS = ['accountId', 'aead', 'amkEpoch', 'bundleId', 'ciphertext', 'kdf', 'nonce', 'purpose', 'revision', 'salt', 'version'];
const ROOT_FIELDS = ['accountId', 'amkEpoch', 'bundleId', 'identityManifestHash', 'identityManifestId', 'identityManifestRevision', 'product', 'productKeyEpoch', 'productRoot', 'revision', 'type'];
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

export interface Authority {
	authorityKeyId: string;
	authorityEpoch: number;
	profileId: string;
	secretKey: Uint8Array;
}

function checkHeader(h: SecretBundleHeader): void {
	requireUuid(h.accountId);
	requireUuid(h.bundleId);
	if (!Number.isSafeInteger(h.amkEpoch) || h.amkEpoch < 0) fail('malformed', 'amkEpoch');
	if (!Number.isSafeInteger(h.revision) || h.revision < 1) fail('malformed', 'revision');
}

function contextJson(h: SecretBundleHeader): Obj {
	return { accountId: h.accountId, bundleId: h.bundleId, revision: h.revision, amkEpoch: h.amkEpoch };
}

async function sealSecret(amk: Uint8Array, h: SecretBundleHeader, plain: Uint8Array): Promise<Uint8Array> {
	if (amk.length !== SECRET_LEN) fail('malformed', 'amk length');
	checkHeader(h);
	const env: Obj = {
		version: 2,
		purpose: 'secret-bundle',
		accountId: h.accountId,
		amkEpoch: h.amkEpoch,
		bundleId: h.bundleId,
		revision: h.revision,
		kdf: KDF,
		aead: AEAD,
		salt: b64encode(randomBytes(SALT_LEN)),
		nonce: b64encode(randomBytes(NONCE_LEN))
	};
	const ct = await seal(amk, INFO, encodeCanonical(env), bin(env, 'salt'), bin(env, 'nonce'), plain);
	return encodeCanonical({ ...env, ciphertext: b64encode(ct) });
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

function parseEnvelope(raw: Uint8Array): { env: Obj; header: SecretBundleHeader } {
	const env = exact(decodeCanonical(raw, MAX_RECORD_BYTES), ENVELOPE_FIELDS);
	if (int(env, 'version') !== 2 || str(env, 'purpose') !== 'secret-bundle') fail('malformed', 'version or purpose');
	checkCipher(str(env, 'kdf'), str(env, 'aead'), bin(env, 'salt'), bin(env, 'nonce'), bin(env, 'ciphertext'));
	return {
		env,
		header: { accountId: id(env, 'accountId'), amkEpoch: int(env, 'amkEpoch'), bundleId: id(env, 'bundleId'), revision: int(env, 'revision', 1) }
	};
}

export function parseSecretBundle(raw: Uint8Array): SecretBundleHeader {
	return parseEnvelope(raw).header;
}

async function openSecret(amk: Uint8Array, raw: Uint8Array, expect: SecretBundleHeader, type: string): Promise<Obj> {
	if (amk.length !== SECRET_LEN) fail('malformed', 'amk length');
	const { env, header } = parseEnvelope(raw);
	if (header.accountId !== expect.accountId || header.amkEpoch !== expect.amkEpoch || header.bundleId !== expect.bundleId || header.revision !== expect.revision) {
		fail('context');
	}
	const { ciphertext: _ct, ...withoutCiphertext } = env;
	const plain = await open(amk, INFO, encodeCanonical(withoutCiphertext), bin(env, 'salt'), bin(env, 'nonce'), bin(env, 'ciphertext'));
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
