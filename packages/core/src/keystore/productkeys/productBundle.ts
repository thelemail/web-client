import type { Json } from './canonical';
import { decodeCanonical, encodeCanonical } from './canonical';
import { b64encode, bytesEqual, requireUuid } from './encoding';
import { checkCipher, open, randomBytes, seal, AEAD, KDF, NONCE_LEN, SALT_LEN, SECRET_LEN } from './envelope';
import { fail } from './errors';
import type { Obj } from './fields';
import { array, bin, exact, id, int, MAX_RECORD_BYTES, optBin, profileId, sortedUnique, str } from './fields';
import { isMailKeyProfile, PROFILE } from './profiles';

export const PRODUCTS = ['app', 'calendar'] as const;
export type Product = (typeof PRODUCTS)[number];

export const ENTRY = {
	mailIdentity: 'mail.identity',
	mailAlias: 'mail.alias',
	mailImportDedup: 'mail.import-dedup',
	mailSearchIndex: 'mail.search-index',
	mailSearchRoot: 'mail.search-root',
	calendarIdentity: 'calendar.identity'
} as const;

export const AVAILABILITIES = ['available', 'migration-only', 'archive-only', 'destroyed-managed', 'unavailable'] as const;
export type Availability = (typeof AVAILABILITIES)[number];

const INFO = 'thelemail/product-bundle/v1';
const TYPE = 'thelemail-product-bundle/v1';
const ENVELOPE_FIELDS = ['accountId', 'aead', 'bundleId', 'ciphertext', 'kdf', 'nonce', 'product', 'productKeyEpoch', 'purpose', 'revision', 'salt', 'version'];
const CONTENT_FIELDS = ['accountId', 'bundleId', 'entries', 'product', 'productKeyEpoch', 'revision', 'type'];
const ENTRY_FIELDS = ['availability', 'keyEpoch', 'keyId', 'material', 'profileId', 'purpose', 'scopeId'];

export interface ProductBundleHeader {
	accountId: string;
	product: Product;
	productKeyEpoch: number;
	bundleId: string;
	revision: number;
}

export interface Entry {
	keyId: string;
	scopeId: string;
	purpose: string;
	profileId: string;
	keyEpoch: number;
	availability: Availability;
	material: Uint8Array | null;
}

export function isProduct(p: unknown): p is Product {
	return typeof p === 'string' && (PRODUCTS as readonly string[]).includes(p);
}

function checkHeader(h: ProductBundleHeader): void {
	if (!isProduct(h.product)) fail('malformed', 'product');
	requireUuid(h.accountId);
	requireUuid(h.bundleId);
	if (!Number.isSafeInteger(h.productKeyEpoch) || h.productKeyEpoch < 1) fail('malformed', 'productKeyEpoch');
	if (!Number.isSafeInteger(h.revision) || h.revision < 1) fail('malformed', 'revision');
}

function admissible(product: Product, e: Entry): boolean {
	if (product === 'app') {
		switch (e.purpose) {
			case ENTRY.mailIdentity:
			case ENTRY.mailAlias:
				return isMailKeyProfile(e.profileId);
			case ENTRY.mailImportDedup:
				return e.profileId === PROFILE.mailImportDedup && e.availability === 'available' && e.material?.length === SECRET_LEN;
			case ENTRY.mailSearchIndex:
				return e.profileId === PROFILE.mailSearchIndex && e.availability === 'available' && e.material?.length === SECRET_LEN;
			case ENTRY.mailSearchRoot:
				return e.profileId === PROFILE.mailSearchRoot && e.availability === 'available' && e.material?.length === SECRET_LEN;
		}
		return false;
	}
	return e.purpose === ENTRY.calendarIdentity && e.profileId === PROFILE.calendarIdentity;
}

function checkEntries(product: Product, entries: Entry[], forbidden: Uint8Array[]): void {
	sortedUnique(entries, (e) => e.keyId);
	const singletons = new Set<string>();
	for (const e of entries) {
		requireUuid(e.keyId);
		requireUuid(e.scopeId);
		if (!Number.isSafeInteger(e.keyEpoch) || e.keyEpoch < 1) fail('malformed', 'keyEpoch');
		if (e.profileId.length < 1 || e.profileId.length > 128) fail('malformed', 'profileId');
		if (!(AVAILABILITIES as readonly string[]).includes(e.availability)) fail('malformed', 'availability');
		const held = e.availability === 'available' || e.availability === 'migration-only';
		if (held !== (e.material !== null && e.material.length > 0)) fail('malformed', 'material does not match availability');
		if (e.material !== null && e.material.length === 0) fail('malformed', 'empty material');
		if (!admissible(product, e)) fail('forbidden', `entry ${e.purpose}`);
		if (e.purpose === ENTRY.mailImportDedup || e.purpose === ENTRY.mailSearchIndex || e.purpose === ENTRY.mailSearchRoot) {
			if (singletons.has(e.purpose)) fail('malformed', `repeated ${e.purpose}`);
			singletons.add(e.purpose);
		}
		for (const f of forbidden) {
			if (f.length > 0 && e.material && bytesEqual(f, e.material)) fail('forbidden', 'root material as an entry');
		}
	}
}

function entryJson(e: Entry): Json {
	return {
		keyId: e.keyId,
		scopeId: e.scopeId,
		purpose: e.purpose,
		profileId: e.profileId,
		keyEpoch: e.keyEpoch,
		availability: e.availability,
		material: e.material ? b64encode(e.material) : null
	};
}

function envelopeJson(h: ProductBundleHeader, salt: Uint8Array, nonce: Uint8Array): Obj {
	return {
		version: 1,
		purpose: 'product-bundle',
		accountId: h.accountId,
		product: h.product,
		productKeyEpoch: h.productKeyEpoch,
		bundleId: h.bundleId,
		revision: h.revision,
		kdf: KDF,
		aead: AEAD,
		salt: b64encode(salt),
		nonce: b64encode(nonce)
	};
}

export async function sealProductBundle(
	root: Uint8Array,
	h: ProductBundleHeader,
	entries: Entry[],
	forbidden: Uint8Array[]
): Promise<Uint8Array> {
	if (root.length !== SECRET_LEN) fail('malformed', 'product root length');
	checkHeader(h);
	checkEntries(h.product, entries, [root, ...forbidden]);
	const plain = encodeCanonical({
		type: TYPE,
		accountId: h.accountId,
		product: h.product,
		productKeyEpoch: h.productKeyEpoch,
		bundleId: h.bundleId,
		revision: h.revision,
		entries: entries.map(entryJson)
	});
	if (plain.length > MAX_RECORD_BYTES) fail('too-large');
	const env = envelopeJson(h, randomBytes(SALT_LEN), randomBytes(NONCE_LEN));
	const aad = encodeCanonical(env);
	const ct = await seal(root, INFO, aad, bin(env, 'salt'), bin(env, 'nonce'), plain);
	const out = encodeCanonical({ ...env, ciphertext: b64encode(ct) });
	if (out.length > MAX_RECORD_BYTES) fail('too-large');
	return out;
}

function parseEnvelope(raw: Uint8Array): { env: Obj; header: ProductBundleHeader } {
	const env = exact(decodeCanonical(raw, MAX_RECORD_BYTES), ENVELOPE_FIELDS);
	if (int(env, 'version') !== 1 || str(env, 'purpose') !== 'product-bundle') fail('malformed', 'version or purpose');
	checkCipher(str(env, 'kdf'), str(env, 'aead'), bin(env, 'salt'), bin(env, 'nonce'), bin(env, 'ciphertext'));
	const product = str(env, 'product');
	if (!isProduct(product)) fail('malformed', 'product');
	const header: ProductBundleHeader = {
		accountId: id(env, 'accountId'),
		product,
		productKeyEpoch: int(env, 'productKeyEpoch', 1),
		bundleId: id(env, 'bundleId'),
		revision: int(env, 'revision', 1)
	};
	return { env, header };
}

export function parseProductBundle(raw: Uint8Array): ProductBundleHeader {
	return parseEnvelope(raw).header;
}

function sameHeader(a: ProductBundleHeader, b: ProductBundleHeader): boolean {
	return a.accountId === b.accountId && a.product === b.product && a.productKeyEpoch === b.productKeyEpoch && a.bundleId === b.bundleId && a.revision === b.revision;
}

export async function openProductBundle(
	root: Uint8Array,
	raw: Uint8Array,
	expect: ProductBundleHeader,
	forbidden: Uint8Array[]
): Promise<Entry[]> {
	if (root.length !== SECRET_LEN) fail('malformed', 'product root length');
	const { env, header } = parseEnvelope(raw);
	if (!sameHeader(header, expect)) fail('context');
	const { ciphertext: _ct, ...withoutCiphertext } = env;
	const plain = await open(root, INFO, encodeCanonical(withoutCiphertext), bin(env, 'salt'), bin(env, 'nonce'), bin(env, 'ciphertext'));
	const c = exact(decodeCanonical(plain, MAX_RECORD_BYTES), CONTENT_FIELDS);
	if (
		str(c, 'type') !== TYPE ||
		c.accountId !== env.accountId ||
		c.product !== env.product ||
		c.productKeyEpoch !== env.productKeyEpoch ||
		c.bundleId !== env.bundleId ||
		c.revision !== env.revision
	) {
		fail('context');
	}
	const entries = array(c, 'entries').map((item) => {
		const o = exact(item, ENTRY_FIELDS);
		const availability = str(o, 'availability');
		if (!(AVAILABILITIES as readonly string[]).includes(availability)) fail('malformed', 'availability');
		return {
			keyId: id(o, 'keyId'),
			scopeId: id(o, 'scopeId'),
			purpose: str(o, 'purpose'),
			profileId: profileId(o, 'profileId'),
			keyEpoch: int(o, 'keyEpoch', 1),
			availability: availability as Availability,
			material: optBin(o, 'material')
		};
	});
	checkEntries(header.product, entries, [root, ...forbidden]);
	return entries;
}
