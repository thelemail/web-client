import type { Json } from './canonical';
import { decodeCanonical, encodeCanonical } from './canonical';
import { b64encode, bytesEqual, requireUuid } from './encoding';
import { transcriptHash } from './envelope';
import { fail } from './errors';
import type { Obj } from './fields';
import {
	array,
	bool,
	chainLink,
	exact,
	hash,
	id,
	int,
	MAX_RECORD_BYTES,
	optBin,
	profileId,
	revisionKey,
	sortedUnique,
	str,
	timestamp,
	tupleKey
} from './fields';
import type { Availability, Product } from './productBundle';
import { AVAILABILITIES, isProduct } from './productBundle';
import { PROFILE } from './profiles';

export const DOMAIN = {
	identityManifest: 'thelemail/product-identity-manifest/v1',
	dataManifest: 'thelemail/product-data-manifest/v1',
	delegation: 'thelemail/product-delegation/v1'
} as const;

export const USAGE = { mailIdentity: 'mail-identity', mailAlias: 'mail-alias', calendarIdentity: 'calendar-identity' } as const;

const PURPOSES: Record<Product, string[]> = {
	app: ['mail.state'],
	calendar: ['calendar.freebusy', 'calendar.grant', 'calendar.invite', 'calendar.reply', 'calendar.state']
};
const USAGES: Record<Product, string[]> = { app: [USAGE.mailAlias, USAGE.mailIdentity], calendar: [USAGE.calendarIdentity] };
const MAX_DATA_ENTRIES = 128;
const KIND_RE = /^[a-z0-9][a-z0-9.-]{0,63}$/;

const IDENTITY_FIELDS = ['accountId', 'authorityEpoch', 'authorityKeyId', 'bundles', 'delegationHash', 'identityKeys', 'issuedAt', 'manifestId', 'previousManifestHash', 'product', 'productKeyEpoch', 'revision', 'type'];
const IDENTITY_KEY_FIELDS = ['keyEpoch', 'keyId', 'privateAvailability', 'profileId', 'publicKeyDigest', 'usage'];
const BUNDLE_REF_FIELDS = ['bundleId', 'byteLength', 'ciphertextHash', 'profileId', 'revision'];
const DATA_FIELDS = ['accountId', 'delegationRevision', 'entries', 'issuedAt', 'manifestId', 'page', 'pageCount', 'previousManifestHash', 'previousPageHash', 'product', 'productKeyEpoch', 'revision', 'signerKeyId', 'type'];
const DATA_ENTRY_FIELDS = ['byteLength', 'ciphertextHash', 'contentRevision', 'keyEpoch', 'kind', 'membershipRevision', 'objectId', 'profileId', 'scopeId', 'tombstone'];
const DELEGATION_FIELDS = ['accountId', 'authorityEpoch', 'authorityKeyId', 'delegationRevision', 'issuedAt', 'previousDelegationHash', 'product', 'productKeyEpoch', 'purposes', 'recipientKeyId', 'recipientProfileId', 'recipientPublicKeyDigest', 'signingKeyId', 'signingProfileId', 'signingPublicKeyDigest', 'type'];

export interface IdentityKey {
	keyId: string;
	profileId: string;
	usage: string;
	keyEpoch: number;
	publicKeyDigest: Uint8Array;
	privateAvailability: Availability;
}

export interface BundleRef {
	bundleId: string;
	revision: number;
	ciphertextHash: Uint8Array;
	byteLength: number;
	profileId: string;
}

export interface IdentityManifest {
	accountId: string;
	product: Product;
	productKeyEpoch: number;
	manifestId: string;
	revision: number;
	previousManifestHash: Uint8Array | null;
	authorityKeyId: string;
	authorityEpoch: number;
	delegationHash: Uint8Array;
	issuedAt: string;
	identityKeys: IdentityKey[];
	bundles: BundleRef[];
}

export interface DataEntry {
	scopeId: string;
	objectId: string;
	kind: string;
	keyEpoch: number;
	contentRevision: number;
	ciphertextHash: Uint8Array | null;
	byteLength: number;
	profileId: string;
	membershipRevision: number;
	tombstone: boolean;
}

export interface DataManifest {
	accountId: string;
	product: Product;
	productKeyEpoch: number;
	manifestId: string;
	revision: number;
	previousManifestHash: Uint8Array | null;
	signerKeyId: string;
	delegationRevision: number;
	issuedAt: string;
	page: number;
	pageCount: number;
	previousPageHash: Uint8Array | null;
	entries: DataEntry[];
}

export interface Delegation {
	accountId: string;
	authorityKeyId: string;
	authorityEpoch: number;
	product: Product;
	productKeyEpoch: number;
	signingKeyId: string;
	signingProfileId: string;
	signingPublicKeyDigest: Uint8Array;
	recipientKeyId: string;
	recipientProfileId: string;
	recipientPublicKeyDigest: Uint8Array;
	purposes: string[];
	issuedAt: string;
	delegationRevision: number;
	previousDelegationHash: Uint8Array | null;
}

const opt = (b: Uint8Array | null): Json => (b ? b64encode(b) : null);

function product(o: Obj): Product {
	const p = str(o, 'product');
	if (!isProduct(p)) fail('malformed', 'product');
	return p;
}

function availability(o: Obj, key: string): Availability {
	const a = str(o, key);
	if (!(AVAILABILITIES as readonly string[]).includes(a)) fail('malformed', key);
	return a as Availability;
}

function checkIdentity(m: IdentityManifest): void {
	if (m.bundles.length === 0) fail('malformed', 'identity keys or bundles');
	sortedUnique(m.identityKeys, (k) => k.keyId);
	for (const k of m.identityKeys) {
		if (!USAGES[m.product].includes(k.usage)) fail('malformed', 'identity key usage');
	}
	sortedUnique(m.bundles, (b) => tupleKey(b.bundleId, revisionKey(b.revision)));
	for (const b of m.bundles) {
		if (b.byteLength < 1 || b.byteLength > MAX_RECORD_BYTES || b.profileId !== PROFILE.productBundleV1) fail('malformed', 'bundle reference');
	}
}

export function parseIdentityManifest(raw: Uint8Array): IdentityManifest {
	const o = exact(decodeCanonical(raw, MAX_RECORD_BYTES), IDENTITY_FIELDS);
	if (str(o, 'type') !== 'thelemail-product-identity-manifest/v1') fail('malformed', 'type');
	const revision = int(o, 'revision', 1);
	const m: IdentityManifest = {
		accountId: id(o, 'accountId'),
		product: product(o),
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		manifestId: id(o, 'manifestId'),
		revision,
		previousManifestHash: chainLink(o, 'previousManifestHash', revision),
		authorityKeyId: id(o, 'authorityKeyId'),
		authorityEpoch: int(o, 'authorityEpoch', 1),
		delegationHash: hash(o, 'delegationHash'),
		issuedAt: timestamp(o, 'issuedAt'),
		identityKeys: array(o, 'identityKeys').map((item) => {
			const k = exact(item, IDENTITY_KEY_FIELDS);
			return {
				keyId: id(k, 'keyId'),
				profileId: profileId(k, 'profileId'),
				usage: str(k, 'usage'),
				keyEpoch: int(k, 'keyEpoch', 1),
				publicKeyDigest: hash(k, 'publicKeyDigest'),
				privateAvailability: availability(k, 'privateAvailability')
			};
		}),
		bundles: array(o, 'bundles').map((item) => {
			const b = exact(item, BUNDLE_REF_FIELDS);
			return {
				bundleId: id(b, 'bundleId'),
				revision: int(b, 'revision', 1),
				ciphertextHash: hash(b, 'ciphertextHash'),
				byteLength: int(b, 'byteLength', 1),
				profileId: str(b, 'profileId')
			};
		})
	};
	checkIdentity(m);
	return m;
}

export function encodeIdentityManifest(m: IdentityManifest): Uint8Array {
	const raw = encodeCanonical({
		type: 'thelemail-product-identity-manifest/v1',
		accountId: m.accountId,
		product: m.product,
		productKeyEpoch: m.productKeyEpoch,
		manifestId: m.manifestId,
		revision: m.revision,
		previousManifestHash: opt(m.previousManifestHash),
		authorityKeyId: m.authorityKeyId,
		authorityEpoch: m.authorityEpoch,
		delegationHash: b64encode(m.delegationHash),
		issuedAt: m.issuedAt,
		identityKeys: m.identityKeys.map((k) => ({
			keyId: k.keyId,
			profileId: k.profileId,
			usage: k.usage,
			keyEpoch: k.keyEpoch,
			publicKeyDigest: b64encode(k.publicKeyDigest),
			privateAvailability: k.privateAvailability
		})),
		bundles: m.bundles.map((b) => ({
			bundleId: b.bundleId,
			revision: b.revision,
			ciphertextHash: b64encode(b.ciphertextHash),
			byteLength: b.byteLength,
			profileId: b.profileId
		}))
	});
	parseIdentityManifest(raw);
	return raw;
}

function checkData(m: DataManifest): void {
	if (m.page > m.pageCount) fail('malformed', 'page beyond count');
	if (m.entries.length > MAX_DATA_ENTRIES) fail('malformed', 'entries');
	sortedUnique(m.entries, (e) => tupleKey(e.scopeId, e.objectId, e.kind));
	for (const e of m.entries) {
		if (!KIND_RE.test(e.kind)) fail('malformed', 'entry kind');
		if (e.tombstone ? e.ciphertextHash !== null || e.byteLength !== 0 : e.ciphertextHash === null) fail('malformed', 'tombstone');
	}
}

export function parseDataManifest(raw: Uint8Array): DataManifest {
	const o = exact(decodeCanonical(raw, MAX_RECORD_BYTES), DATA_FIELDS);
	if (str(o, 'type') !== 'thelemail-product-data-manifest/v1') fail('malformed', 'type');
	const revision = int(o, 'revision', 1);
	const page = int(o, 'page', 1);
	const m: DataManifest = {
		accountId: id(o, 'accountId'),
		product: product(o),
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		manifestId: id(o, 'manifestId'),
		revision,
		previousManifestHash: chainLink(o, 'previousManifestHash', revision),
		signerKeyId: id(o, 'signerKeyId'),
		delegationRevision: int(o, 'delegationRevision', 1),
		issuedAt: timestamp(o, 'issuedAt'),
		page,
		pageCount: int(o, 'pageCount', 1),
		previousPageHash: chainLink(o, 'previousPageHash', page),
		entries: array(o, 'entries').map((item) => {
			const e = exact(item, DATA_ENTRY_FIELDS);
			const kind = str(e, 'kind');
			return {
				scopeId: id(e, 'scopeId'),
				objectId: id(e, 'objectId'),
				kind,
				keyEpoch: int(e, 'keyEpoch'),
				contentRevision: int(e, 'contentRevision'),
				ciphertextHash: optBin(e, 'ciphertextHash', 32),
				byteLength: int(e, 'byteLength'),
				profileId: profileId(e, 'profileId'),
				membershipRevision: int(e, 'membershipRevision'),
				tombstone: bool(e, 'tombstone')
			};
		})
	};
	checkData(m);
	return m;
}

export function encodeDataManifest(m: DataManifest): Uint8Array {
	const raw = encodeCanonical({
		type: 'thelemail-product-data-manifest/v1',
		accountId: m.accountId,
		product: m.product,
		productKeyEpoch: m.productKeyEpoch,
		manifestId: m.manifestId,
		revision: m.revision,
		previousManifestHash: opt(m.previousManifestHash),
		signerKeyId: m.signerKeyId,
		delegationRevision: m.delegationRevision,
		issuedAt: m.issuedAt,
		page: m.page,
		pageCount: m.pageCount,
		previousPageHash: opt(m.previousPageHash),
		entries: m.entries.map((e) => ({
			scopeId: e.scopeId,
			objectId: e.objectId,
			kind: e.kind,
			keyEpoch: e.keyEpoch,
			contentRevision: e.contentRevision,
			ciphertextHash: opt(e.ciphertextHash),
			byteLength: e.byteLength,
			profileId: e.profileId,
			membershipRevision: e.membershipRevision,
			tombstone: e.tombstone
		}))
	});
	parseDataManifest(raw);
	return raw;
}

export async function verifyDataManifestPages(pages: Uint8Array[]): Promise<DataManifest[]> {
	if (pages.length === 0) fail('malformed', 'no pages');
	const out: DataManifest[] = [];
	let previous: Uint8Array | null = null;
	for (let i = 0; i < pages.length; i++) {
		const m = parseDataManifest(pages[i]);
		if (m.page !== i + 1 || m.pageCount !== pages.length) fail('context', `page ${m.page} of ${m.pageCount}`);
		if (i > 0) {
			const f = out[0];
			const samePrev = (a: Uint8Array | null, b: Uint8Array | null) => (a === null ? b === null : b !== null && bytesEqual(a, b));
			if (
				m.accountId !== f.accountId ||
				m.product !== f.product ||
				m.productKeyEpoch !== f.productKeyEpoch ||
				m.manifestId !== f.manifestId ||
				m.revision !== f.revision ||
				m.signerKeyId !== f.signerKeyId ||
				m.delegationRevision !== f.delegationRevision ||
				m.issuedAt !== f.issuedAt ||
				!samePrev(m.previousManifestHash, f.previousManifestHash) ||
				!samePrev(m.previousPageHash, previous)
			) {
				fail('context', `page ${m.page} does not continue the manifest`);
			}
		}
		previous = await transcriptHash(DOMAIN.dataManifest, pages[i]);
		out.push(m);
	}
	return out;
}

export function productPurposes(p: Product): string[] {
	return [...PURPOSES[p]];
}

export function parseDelegation(raw: Uint8Array): Delegation {
	const o = exact(decodeCanonical(raw, MAX_RECORD_BYTES), DELEGATION_FIELDS);
	if (str(o, 'type') !== 'thelemail-product-delegation/v1') fail('malformed', 'type');
	const revision = int(o, 'delegationRevision', 1);
	const d: Delegation = {
		accountId: id(o, 'accountId'),
		authorityKeyId: id(o, 'authorityKeyId'),
		authorityEpoch: int(o, 'authorityEpoch', 1),
		product: product(o),
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		signingKeyId: id(o, 'signingKeyId'),
		signingProfileId: profileId(o, 'signingProfileId'),
		signingPublicKeyDigest: hash(o, 'signingPublicKeyDigest'),
		recipientKeyId: id(o, 'recipientKeyId'),
		recipientProfileId: profileId(o, 'recipientProfileId'),
		recipientPublicKeyDigest: hash(o, 'recipientPublicKeyDigest'),
		purposes: array(o, 'purposes').map((p) => {
			if (typeof p !== 'string') fail('malformed', 'purpose');
			return p;
		}),
		issuedAt: timestamp(o, 'issuedAt'),
		delegationRevision: revision,
		previousDelegationHash: chainLink(o, 'previousDelegationHash', revision)
	};
	if (d.purposes.length === 0) fail('malformed', 'purposes');
	sortedUnique(d.purposes, (p) => p);
	for (const p of d.purposes) if (!PURPOSES[d.product].includes(p)) fail('forbidden', `purpose ${p}`);
	return d;
}

export function encodeDelegation(d: Delegation): Uint8Array {
	requireUuid(d.accountId);
	const raw = encodeCanonical({
		type: 'thelemail-product-delegation/v1',
		accountId: d.accountId,
		authorityKeyId: d.authorityKeyId,
		authorityEpoch: d.authorityEpoch,
		product: d.product,
		productKeyEpoch: d.productKeyEpoch,
		signingKeyId: d.signingKeyId,
		signingProfileId: d.signingProfileId,
		signingPublicKeyDigest: b64encode(d.signingPublicKeyDigest),
		recipientKeyId: d.recipientKeyId,
		recipientProfileId: d.recipientProfileId,
		recipientPublicKeyDigest: b64encode(d.recipientPublicKeyDigest),
		purposes: d.purposes,
		issuedAt: d.issuedAt,
		delegationRevision: d.delegationRevision,
		previousDelegationHash: opt(d.previousDelegationHash)
	});
	parseDelegation(raw);
	return raw;
}
