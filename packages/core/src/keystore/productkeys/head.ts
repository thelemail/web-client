import type * as openpgp from 'openpgp';
import type { Json } from './canonical';
import { decodeCanonical, encodeCanonical, utf8 } from './canonical';
import { b64encode, bytesEqual, keyId, sha256 } from './encoding';
import { transcript, transcriptHash } from './envelope';
import { fail } from './errors';
import type { Obj } from './fields';
import { array, exact, hash, id, int, profileId, sortedUnique, str, timestamp } from './fields';
import { fingerprintBytes, publicKeyDigest, validateProfile, verifyTranscript } from './pgp';
import type { Product } from './productBundle';
import { isProduct } from './productBundle';
import { PROFILE } from './profiles';
import { optBin } from './fields';

export const HEAD_DOMAIN = 'thelemail/account-head/v2';
const HEAD_TYPE = 'thelemail-account-crypto-head/v2';
const MAC_INFO = 'thelemail/account-head-mac/v1';
export const MAX_HEAD_BYTES = 256 << 10;

const HEAD_FIELDS = ['accountId', 'amkEpoch', 'authEpoch', 'authorityEpoch', 'authorityKeyId', 'authorityProfileId', 'authorityPublicKeyDigest', 'bundleDescriptorHashes', 'credentialDescriptorHashes', 'cryptoGeneration', 'currentEncryptionKeyId', 'currentSigningKeyId', 'historyEventCount', 'issuedAt', 'keyEpoch', 'keyHistoryRoot', 'migrationId', 'minimumWriteProfile', 'observedSessionEpoch', 'policyVersion', 'previousHeadHash', 'productDescriptors', 'recoveryEpoch', 'slotDescriptorHashes', 'stateRevision', 'type'];
const DESCRIPTOR_FIELDS = ['delegationHash', 'identityManifestHash', 'identityManifestId', 'identityManifestRevision', 'product', 'productKeyEpoch', 'rootBundleCiphertextHash', 'rootBundleId', 'rootBundleRevision'];

export interface ProductDescriptor {
	product: Product;
	productKeyEpoch: number;
	rootBundleId: string;
	rootBundleRevision: number;
	rootBundleCiphertextHash: Uint8Array;
	identityManifestId: string;
	identityManifestRevision: number;
	identityManifestHash: Uint8Array;
	delegationHash: Uint8Array;
}

export interface HeadV2 {
	accountId: string;
	stateRevision: number;
	previousHeadHash: Uint8Array | null;
	authEpoch: number;
	observedSessionEpoch: number;
	recoveryEpoch: number;
	amkEpoch: number;
	keyEpoch: number;
	cryptoGeneration: number;
	minimumWriteProfile: string | null;
	currentEncryptionKeyId: string;
	currentSigningKeyId: string;
	historyEventCount: number;
	keyHistoryRoot: Uint8Array;
	credentialDescriptorHashes: Uint8Array[];
	slotDescriptorHashes: Uint8Array[];
	bundleDescriptorHashes: Uint8Array[];
	policyVersion: number;
	migrationId: string | null;
	issuedAt: string;
	authorityKeyId: string;
	authorityEpoch: number;
	authorityProfileId: string;
	authorityPublicKeyDigest: Uint8Array;
	productDescriptors: ProductDescriptor[];
}

export interface HeadSignatures {
	authority: Uint8Array | null;
	legacy: Uint8Array | null;
	transition: Uint8Array | null;
}

function hashes(o: Obj, key: string): Uint8Array[] {
	const list = array(o, key).map((v, i) => hash({ [String(i)]: v }, String(i)));
	sortedUnique(list, (h) => h);
	return list;
}

export function parseHeadV2(raw: Uint8Array): HeadV2 {
	const o = exact(decodeCanonical(raw, MAX_HEAD_BYTES), HEAD_FIELDS);
	if (str(o, 'type') !== HEAD_TYPE) fail('malformed', 'head type');
	if (str(o, 'authorityProfileId') !== PROFILE.accountAuthority) fail('malformed', 'authority profile');
	const descriptors = array(o, 'productDescriptors').map((item) => {
		const d = exact(item, DESCRIPTOR_FIELDS);
		const p = str(d, 'product');
		if (!isProduct(p)) fail('malformed', 'product');
		return {
			product: p,
			productKeyEpoch: int(d, 'productKeyEpoch', 1),
			rootBundleId: id(d, 'rootBundleId'),
			rootBundleRevision: int(d, 'rootBundleRevision', 1),
			rootBundleCiphertextHash: hash(d, 'rootBundleCiphertextHash'),
			identityManifestId: id(d, 'identityManifestId'),
			identityManifestRevision: int(d, 'identityManifestRevision', 1),
			identityManifestHash: hash(d, 'identityManifestHash'),
			delegationHash: hash(d, 'delegationHash')
		};
	});
	sortedUnique(descriptors, (d) => d.product);
	const minimum = o.minimumWriteProfile === null ? null : profileId(o, 'minimumWriteProfile');
	const migration = o.migrationId === null ? null : id(o, 'migrationId');
	return {
		accountId: id(o, 'accountId'),
		stateRevision: int(o, 'stateRevision', 1),
		previousHeadHash: optBin(o, 'previousHeadHash', 32),
		authEpoch: int(o, 'authEpoch'),
		observedSessionEpoch: int(o, 'observedSessionEpoch'),
		recoveryEpoch: int(o, 'recoveryEpoch'),
		amkEpoch: int(o, 'amkEpoch'),
		keyEpoch: int(o, 'keyEpoch'),
		cryptoGeneration: int(o, 'cryptoGeneration'),
		minimumWriteProfile: minimum,
		currentEncryptionKeyId: id(o, 'currentEncryptionKeyId'),
		currentSigningKeyId: id(o, 'currentSigningKeyId'),
		historyEventCount: int(o, 'historyEventCount'),
		keyHistoryRoot: hash(o, 'keyHistoryRoot'),
		credentialDescriptorHashes: hashes(o, 'credentialDescriptorHashes'),
		slotDescriptorHashes: hashes(o, 'slotDescriptorHashes'),
		bundleDescriptorHashes: hashes(o, 'bundleDescriptorHashes'),
		policyVersion: int(o, 'policyVersion'),
		migrationId: migration,
		issuedAt: timestamp(o, 'issuedAt'),
		authorityKeyId: id(o, 'authorityKeyId'),
		authorityEpoch: int(o, 'authorityEpoch', 1),
		authorityProfileId: PROFILE.accountAuthority,
		authorityPublicKeyDigest: hash(o, 'authorityPublicKeyDigest'),
		productDescriptors: descriptors
	};
}

export function encodeHeadV2(h: HeadV2): Uint8Array {
	const list = (hs: Uint8Array[]): Json => hs.map(b64encode);
	const raw = encodeCanonical({
		type: HEAD_TYPE,
		accountId: h.accountId,
		stateRevision: h.stateRevision,
		previousHeadHash: h.previousHeadHash ? b64encode(h.previousHeadHash) : null,
		authEpoch: h.authEpoch,
		observedSessionEpoch: h.observedSessionEpoch,
		recoveryEpoch: h.recoveryEpoch,
		amkEpoch: h.amkEpoch,
		keyEpoch: h.keyEpoch,
		cryptoGeneration: h.cryptoGeneration,
		minimumWriteProfile: h.minimumWriteProfile,
		currentEncryptionKeyId: h.currentEncryptionKeyId,
		currentSigningKeyId: h.currentSigningKeyId,
		historyEventCount: h.historyEventCount,
		keyHistoryRoot: b64encode(h.keyHistoryRoot),
		credentialDescriptorHashes: list(h.credentialDescriptorHashes),
		slotDescriptorHashes: list(h.slotDescriptorHashes),
		bundleDescriptorHashes: list(h.bundleDescriptorHashes),
		policyVersion: h.policyVersion,
		migrationId: h.migrationId,
		issuedAt: h.issuedAt,
		authorityKeyId: h.authorityKeyId,
		authorityEpoch: h.authorityEpoch,
		authorityProfileId: h.authorityProfileId,
		authorityPublicKeyDigest: b64encode(h.authorityPublicKeyDigest),
		productDescriptors: h.productDescriptors.map((d) => ({
			product: d.product,
			productKeyEpoch: d.productKeyEpoch,
			rootBundleId: d.rootBundleId,
			rootBundleRevision: d.rootBundleRevision,
			rootBundleCiphertextHash: b64encode(d.rootBundleCiphertextHash),
			identityManifestId: d.identityManifestId,
			identityManifestRevision: d.identityManifestRevision,
			identityManifestHash: b64encode(d.identityManifestHash),
			delegationHash: b64encode(d.delegationHash)
		}))
	});
	if (raw.length > MAX_HEAD_BYTES) fail('too-large');
	parseHeadV2(raw);
	return raw;
}

export function headHash(raw: Uint8Array): Promise<Uint8Array> {
	return transcriptHash(HEAD_DOMAIN, raw);
}

async function macKey(amk: Uint8Array, accountId: string): Promise<CryptoKey> {
	if (amk.length !== 32) fail('malformed', 'amk length');
	const salt = await sha256(utf8(accountId));
	const base = await crypto.subtle.importKey('raw', amk as BufferSource, 'HKDF', false, ['deriveBits']);
	const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: utf8(MAC_INFO) as BufferSource }, base, 256);
	return crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function headMac(amk: Uint8Array, accountId: string, raw: Uint8Array): Promise<Uint8Array> {
	const key = await macKey(amk, accountId);
	return new Uint8Array(await crypto.subtle.sign('HMAC', key, transcript(HEAD_DOMAIN, raw) as BufferSource));
}

export async function verifyHeadMac(amk: Uint8Array, accountId: string, raw: Uint8Array, mac: Uint8Array): Promise<void> {
	if (!bytesEqual(await headMac(amk, accountId, raw), mac)) fail('signature', 'head mac');
}

export async function checkAuthorityKey(h: HeadV2, authority: openpgp.Key): Promise<void> {
	await validateProfile(h.authorityProfileId, authority);
	if (keyId(h.accountId, fingerprintBytes(authority)) !== h.authorityKeyId || !bytesEqual(await publicKeyDigest(authority), h.authorityPublicKeyDigest)) {
		fail('transition', 'authority key does not match the head');
	}
}

function sameHash(a: Uint8Array | null, b: Uint8Array | null): boolean {
	return a === null ? b === null : b !== null && bytesEqual(a, b);
}

export async function verifyBootstrap(
	raw: Uint8Array,
	previousHeadHash: Uint8Array | null,
	sigs: HeadSignatures,
	authority: openpgp.Key,
	legacy: openpgp.Key
): Promise<HeadV2> {
	const h = parseHeadV2(raw);
	if (!sameHash(h.previousHeadHash, previousHeadHash)) fail('transition', 'previous head');
	if (sigs.transition || !sigs.legacy || !sigs.authority) fail('transition', 'bootstrap needs the legacy and authority signatures');
	await checkAuthorityKey(h, authority);
	if (keyId(h.accountId, fingerprintBytes(legacy)) !== h.currentSigningKeyId) fail('transition', 'legacy signer is not the current signing key');
	await verifyTranscript(HEAD_DOMAIN, raw, sigs.legacy, legacy);
	await verifyTranscript(HEAD_DOMAIN, raw, sigs.authority, authority);
	return h;
}

export async function verifySuccessor(
	previousRaw: Uint8Array,
	raw: Uint8Array,
	sigs: HeadSignatures,
	authority: openpgp.Key,
	previousAuthority: openpgp.Key,
	minimumAuthorityEpoch: number
): Promise<HeadV2> {
	const prev = parseHeadV2(previousRaw);
	const h = parseHeadV2(raw);
	if (sigs.legacy) fail('transition', 'a mail key cannot authorize an account head');
	if (h.accountId !== prev.accountId || h.stateRevision !== prev.stateRevision + 1 || !sameHash(h.previousHeadHash, await headHash(previousRaw))) {
		fail('transition', 'head does not continue its predecessor');
	}
	if (h.authorityEpoch < minimumAuthorityEpoch || h.authorityEpoch < prev.authorityEpoch) fail('transition', 'authority epoch below the floor');
	await checkAuthorityKey(prev, previousAuthority);
	await checkAuthorityKey(h, authority);
	if (h.authorityKeyId === prev.authorityKeyId) {
		if (h.authorityEpoch !== prev.authorityEpoch || sigs.transition) fail('transition', 'unchanged authority with a new epoch');
	} else {
		if (h.authorityEpoch <= prev.authorityEpoch || !sigs.transition) fail('transition', 'authority rotation needs a new epoch and the previous authority');
		await verifyTranscript(HEAD_DOMAIN, raw, sigs.transition, previousAuthority);
	}
	if (!sigs.authority) fail('transition', 'authority signature missing');
	await verifyTranscript(HEAD_DOMAIN, raw, sigs.authority, authority);
	return h;
}
