import * as openpgp from 'openpgp';
import { utf8 } from './canonical';
import { b64decode, bytesEqual, compareBytes, concat, keyId, randomUuid, sha256 } from './encoding';
import { randomBytes, SECRET_LEN, transcriptHash } from './envelope';
import { fail } from './errors';
import { formatTime, MAX_RECORD_BYTES } from './fields';
import type { HeadV2, ProductDescriptor } from './head';
import { encodeHeadV2, HEAD_DOMAIN, headMac } from './head';
import type { BundleRef, IdentityKey } from './manifests';
import { DOMAIN, encodeDataManifest, encodeDelegation, encodeIdentityManifest, productPurposes, USAGE } from './manifests';
import { fingerprintBytes, generateAuthorityKey, generateCalendarIdentity, publicKeyBytes, publicKeyDigest, secretKeyBytes, signTranscript } from './pgp';
import type { Availability, Entry, Product } from './productBundle';
import { ENTRY, sealProductBundle } from './productBundle';
import { PROFILE } from './profiles';
import { sealAuthority, sealRootDescriptor } from './secretBundle';

const DEDUP_INFO = 'thelemail/import-dedup-key/v1\u0000';
const SEARCH_INFO = 'thelemail-search-index-v1';
export const BUNDLE_BUDGET = MAX_RECORD_BYTES - 64 * 1024;

export interface HistoryKey {
	keyId: string;
	keyEpoch: number;
	profileId: string;
	publicKeyHash: Uint8Array;
	publicKeyBytes: Uint8Array;
}

export interface ConversionInput {
	accountId: string;
	amk: Uint8Array;
	keyPassword: string;
	scope: {
		stateRevision: number;
		activeKeyEpoch: number;
		activeGeneration: number;
		authEpoch: number;
		recoveryEpoch: number;
		amkEpoch: number;
		minimumWriteProfile: string | null;
		historyEventCount: number;
		keyHistoryRoot: Uint8Array;
	};
	sessionEpoch: number;
	previousHeadHash: Uint8Array | null;
	credentialHashes: Uint8Array[];
	slotHashes: Uint8Array[];
	history: HistoryKey[];
	availability: Map<string, Availability>;
	accountKeys: { armoredEncrypted: string | null; isCurrent: boolean }[];
	aliasKeys: { aliasId: string; keyVersion: number; wrappedPrivateKey: string }[];
	appRoot?: Uint8Array;
	now?: Date;
	bundleBudget?: number;
}

export interface SecretBundleUpload {
	bundleId: string;
	revision: number;
	kind: 'product-root' | 'auth-authority';
	bundle: Uint8Array;
}

export interface ProductBundleUpload {
	product: Product;
	bundleId: string;
	revision: number;
	bundle: Uint8Array;
}

export interface ManifestUpload {
	product: Product;
	kind: 'identity' | 'data';
	revision: number;
	page: number;
	record: Uint8Array;
	signature: Uint8Array;
}

export interface DelegationUpload {
	record: Uint8Array;
	signature: Uint8Array;
	signingPublicKey: Uint8Array;
	recipientPublicKey: Uint8Array;
}

export interface ConversionOutput {
	secretBundles: SecretBundleUpload[];
	productBundles: ProductBundleUpload[];
	identityManifests: ManifestUpload[];
	dataManifests: ManifestUpload[];
	activation: {
		head: Uint8Array;
		mac: Uint8Array;
		authoritySignature: Uint8Array;
		legacySignature: Uint8Array;
		authorityPublicKey: Uint8Array;
		delegations: DelegationUpload[];
	};
}

export async function deriveImportDedupKey(keyPassword: string): Promise<Uint8Array> {
	return sha256(concat(utf8(DEDUP_INFO), utf8(keyPassword)));
}

export async function deriveSearchLeaf(keyPassword: string, accountId: string): Promise<Uint8Array> {
	const base = await crypto.subtle.importKey('raw', utf8(keyPassword) as BufferSource, 'HKDF', false, ['deriveBits']);
	return new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'HKDF', hash: 'SHA-256', salt: utf8(accountId) as BufferSource, info: utf8(SEARCH_INFO) as BufferSource },
			base,
			256
		)
	);
}

export function stripUserIds(key: openpgp.Key): Uint8Array {
	const packets = key.toPublic().toPacketList();
	const kept = new openpgp.PacketList<openpgp.AnyPacket>();
	let skipping = false;
	for (const p of packets) {
		const tag = (p.constructor as unknown as { tag: number }).tag;
		if (tag === openpgp.enums.packet.userID || tag === openpgp.enums.packet.userAttribute) {
			skipping = true;
			continue;
		}
		if (tag === openpgp.enums.packet.signature && skipping) continue;
		skipping = false;
		kept.push(p);
	}
	return kept.write();
}

export function mailProfile(key: openpgp.Key): string {
	const primary = key.keyPacket;
	const enc = key.subkeys.find((s) => s.keyPacket.algorithm === openpgp.enums.publicKey.x25519 || s.keyPacket.algorithm === openpgp.enums.publicKey.ecdh);
	if (primary.version === 6 && primary.algorithm === openpgp.enums.publicKey.ed25519 && enc?.keyPacket.algorithm === openpgp.enums.publicKey.x25519) {
		return PROFILE.mailClassic;
	}
	if (primary.version === 4 && primary.algorithm === openpgp.enums.publicKey.ed25519 && enc?.keyPacket.algorithm === openpgp.enums.publicKey.x25519) {
		return `${PROFILE.legacyImportPrefix}openpgp-curve25519-v4`;
	}
	if (primary.version === 4 && primary.algorithm === openpgp.enums.publicKey.eddsaLegacy && enc?.keyPacket.algorithm === openpgp.enums.publicKey.ecdh) {
		return `${PROFILE.legacyImportPrefix}openpgp-curve25519-legacy`;
	}
	return `${PROFILE.legacyImportPrefix}openpgp-${openpgp.enums.read(openpgp.enums.publicKey, primary.algorithm)}-v${primary.version}`;
}

async function unlock(armored: string, passphrase: string): Promise<openpgp.PrivateKey> {
	const privateKey = await openpgp.readPrivateKey({ armoredKey: armored });
	return privateKey.isDecrypted() ? privateKey : openpgp.decryptKey({ privateKey, passphrase });
}

export async function unlockAccountKeys(input: Pick<ConversionInput, 'accountKeys' | 'keyPassword'>): Promise<{ unlocked: openpgp.PrivateKey[]; current: openpgp.PrivateKey }> {
	const unlocked: openpgp.PrivateKey[] = [];
	let current: openpgp.PrivateKey | null = null;
	for (const k of input.accountKeys) {
		if (!k.armoredEncrypted) {
			if (k.isCurrent) fail('context', 'current key has no private material');
			continue;
		}
		const key = await unlock(k.armoredEncrypted, input.keyPassword);
		unlocked.push(key);
		if (k.isCurrent) {
			if (current) fail('context', 'more than one current key');
			current = key;
		}
	}
	if (!current) fail('context', 'no current key');
	return { unlocked, current };
}

export async function mailEntries(
	input: Pick<ConversionInput, 'accountId' | 'keyPassword' | 'history' | 'availability' | 'aliasKeys'>,
	unlocked: openpgp.PrivateKey[],
	forbidden: Uint8Array[]
): Promise<{ entries: Entry[]; keys: IdentityKey[] }> {
	const material = new Map<string, Uint8Array>();
	for (const key of unlocked) material.set(keyId(input.accountId, fingerprintBytes(key)), secretKeyBytes(key));
	const entries: Entry[] = [];
	const keys: IdentityKey[] = [];
	for (const h of input.history) {
		const stated = input.availability.get(h.keyId) ?? 'unavailable';
		const held = stated === 'available' || stated === 'migration-only';
		const bytes = held ? (material.get(h.keyId) ?? null) : null;
		const availability: Availability = held && !bytes ? 'unavailable' : stated;
		entries.push({ keyId: h.keyId, scopeId: input.accountId, purpose: ENTRY.mailIdentity, profileId: h.profileId, keyEpoch: h.keyEpoch, availability, material: bytes });
		keys.push({ keyId: h.keyId, profileId: h.profileId, usage: USAGE.mailIdentity, keyEpoch: h.keyEpoch, publicKeyDigest: h.publicKeyHash, privateAvailability: availability });
	}
	for (const g of input.aliasKeys) {
		const message = await openpgp.readMessage({ armoredMessage: g.wrappedPrivateKey });
		const { data } = await openpgp.decrypt({ message, decryptionKeys: unlocked, expectSigned: false });
		if (typeof data !== 'string') fail('malformed', 'alias key');
		const alias = await openpgp.readPrivateKey({ armoredKey: data });
		const id = keyId(g.aliasId, fingerprintBytes(alias));
		if (entries.some((e) => e.keyId === id)) continue;
		const profileId = mailProfile(alias);
		entries.push({ keyId: id, scopeId: g.aliasId, purpose: ENTRY.mailAlias, profileId, keyEpoch: g.keyVersion, availability: 'available', material: secretKeyBytes(alias) });
		keys.push({ keyId: id, profileId, usage: USAGE.mailAlias, keyEpoch: g.keyVersion, publicKeyDigest: await sha256(stripUserIds(alias)), privateAvailability: 'available' });
	}
	entries.push({
		keyId: randomUuid(),
		scopeId: input.accountId,
		purpose: ENTRY.mailImportDedup,
		profileId: PROFILE.mailImportDedup,
		keyEpoch: 1,
		availability: 'available',
		material: await deriveImportDedupKey(input.keyPassword)
	});
	entries.push({
		keyId: randomUuid(),
		scopeId: input.accountId,
		purpose: ENTRY.mailSearchIndex,
		profileId: PROFILE.mailSearchIndex,
		keyEpoch: 1,
		availability: 'available',
		material: await deriveSearchLeaf(input.keyPassword, input.accountId)
	});
	for (const e of entries) {
		for (const f of forbidden) if (e.material && bytesEqual(e.material, f)) fail('forbidden', 'root material as an entry');
	}
	entries.sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
	keys.sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
	return { entries, keys };
}

function chunk(entries: Entry[], budget: number): Entry[][] {
	const pages: Entry[][] = [];
	let page: Entry[] = [];
	let size = 0;
	for (const e of entries) {
		const cost = 512 + Math.ceil(((e.material?.length ?? 0) * 4) / 3);
		if (page.length > 0 && size + cost > budget) {
			pages.push(page);
			page = [];
			size = 0;
		}
		page.push(e);
		size += cost;
	}
	pages.push(page);
	return pages;
}

export async function sealPages(
	root: Uint8Array,
	accountId: string,
	product: Product,
	entries: Entry[],
	forbidden: Uint8Array[],
	budget: number
): Promise<{ uploads: ProductBundleUpload[]; refs: BundleRef[] }> {
	const uploads: ProductBundleUpload[] = [];
	const refs: BundleRef[] = [];
	for (const page of chunk(entries, budget)) {
		const bundleId = randomUuid();
		const bundle = await sealProductBundle(root, { accountId, product, productKeyEpoch: 1, bundleId, revision: 1 }, page, forbidden);
		uploads.push({ product, bundleId, revision: 1, bundle });
		refs.push({ bundleId, revision: 1, ciphertextHash: await sha256(bundle), byteLength: bundle.length, profileId: PROFILE.productBundleV1 });
	}
	refs.sort((a, b) => (a.bundleId < b.bundleId ? -1 : 1));
	return { uploads, refs };
}

export async function buildConversion(input: ConversionInput): Promise<ConversionOutput> {
	if (input.amk.length !== SECRET_LEN) fail('malformed', 'amk length');
	const now = formatTime(input.now ?? new Date());
	const accountId = input.accountId;
	const { unlocked, current: currentKey } = await unlockAccountKeys(input);
	const currentId = keyId(accountId, fingerprintBytes(currentKey));
	const current = input.history.find((h) => h.keyId === currentId);
	if (!current) fail('context', 'current key is not in key history');

	const aak = await generateAuthorityKey();
	const cal = await generateCalendarIdentity();
	const aakPublic = publicKeyBytes(aak);
	const calPublic = publicKeyBytes(cal);
	const aakId = keyId(accountId, fingerprintBytes(aak));
	const calId = keyId(accountId, fingerprintBytes(cal));
	if (input.appRoot && input.appRoot.length !== SECRET_LEN) fail('malformed', 'adopted mail root length');
	const appRoot = input.appRoot ? input.appRoot.slice() : randomBytes(SECRET_LEN);
	const calRoot = randomBytes(SECRET_LEN);
	const roots = [input.amk, utf8(input.keyPassword), appRoot, calRoot];

	const mail = await mailEntries(input, unlocked, roots);
	const budget = Math.min(input.bundleBudget ?? BUNDLE_BUDGET, BUNDLE_BUDGET);
	const appSealed = await sealPages(appRoot, accountId, 'app', mail.entries, roots, budget);
	const calEntries: Entry[] = [
		{ keyId: calId, scopeId: accountId, purpose: ENTRY.calendarIdentity, profileId: PROFILE.calendarIdentity, keyEpoch: 1, availability: 'available', material: secretKeyBytes(cal) }
	];
	const calSealed = await sealPages(calRoot, accountId, 'calendar', calEntries, roots, budget);

	const delegationBase = { accountId, authorityKeyId: aakId, authorityEpoch: 1, productKeyEpoch: 1, issuedAt: now, delegationRevision: 1, previousDelegationHash: null };
	const appDelegation = encodeDelegation({
		...delegationBase,
		product: 'app',
		signingKeyId: current.keyId,
		signingProfileId: current.profileId,
		signingPublicKeyDigest: current.publicKeyHash,
		recipientKeyId: current.keyId,
		recipientProfileId: current.profileId,
		recipientPublicKeyDigest: current.publicKeyHash,
		purposes: productPurposes('app')
	});
	const calDigest = await publicKeyDigest(cal);
	const calDelegation = encodeDelegation({
		...delegationBase,
		product: 'calendar',
		signingKeyId: calId,
		signingProfileId: PROFILE.calendarIdentity,
		signingPublicKeyDigest: calDigest,
		recipientKeyId: calId,
		recipientProfileId: PROFILE.calendarIdentity,
		recipientPublicKeyDigest: calDigest,
		purposes: productPurposes('calendar')
	});

	const identity = async (product: Product, keys: IdentityKey[], refs: BundleRef[], delegation: Uint8Array) => {
		const manifestId = randomUuid();
		const record = encodeIdentityManifest({
			accountId,
			product,
			productKeyEpoch: 1,
			manifestId,
			revision: 1,
			previousManifestHash: null,
			authorityKeyId: aakId,
			authorityEpoch: 1,
			delegationHash: await transcriptHash(DOMAIN.delegation, delegation),
			issuedAt: now,
			identityKeys: keys,
			bundles: refs
		});
		return { manifestId, record, signature: await signTranscript(DOMAIN.identityManifest, record, aak) };
	};
	const appManifest = await identity('app', mail.keys, appSealed.refs, appDelegation);
	const calManifest = await identity(
		'calendar',
		[{ keyId: calId, profileId: PROFILE.calendarIdentity, usage: USAGE.calendarIdentity, keyEpoch: 1, publicKeyDigest: calDigest, privateAvailability: 'available' }],
		calSealed.refs,
		calDelegation
	);

	const amkEpoch = input.scope.amkEpoch;
	const secretBundles: SecretBundleUpload[] = [];
	const descriptors: ProductDescriptor[] = [];
	for (const [product, root, manifest, delegation] of [
		['app', appRoot, appManifest, appDelegation],
		['calendar', calRoot, calManifest, calDelegation]
	] as const) {
		const bundleId = randomUuid();
		const manifestHash = await transcriptHash(DOMAIN.identityManifest, manifest.record);
		const bundle = await sealRootDescriptor(
			input.amk,
			{ accountId, amkEpoch, bundleId, revision: 1 },
			{ product, productKeyEpoch: 1, productRoot: root, identityManifestId: manifest.manifestId, identityManifestRevision: 1, identityManifestHash: manifestHash }
		);
		secretBundles.push({ bundleId, revision: 1, kind: 'product-root', bundle });
		descriptors.push({
			product,
			productKeyEpoch: 1,
			rootBundleId: bundleId,
			rootBundleRevision: 1,
			rootBundleCiphertextHash: await sha256(bundle),
			identityManifestId: manifest.manifestId,
			identityManifestRevision: 1,
			identityManifestHash: manifestHash,
			delegationHash: await transcriptHash(DOMAIN.delegation, delegation)
		});
	}
	const authorityId = randomUuid();
	const authorityBundle = await sealAuthority(
		input.amk,
		{ accountId, amkEpoch, bundleId: authorityId, revision: 1 },
		{ authorityKeyId: aakId, authorityEpoch: 1, profileId: PROFILE.accountAuthority, secretKey: secretKeyBytes(aak) }
	);
	secretBundles.push({ bundleId: authorityId, revision: 1, kind: 'auth-authority', bundle: authorityBundle });

	const sorted = (hs: Uint8Array[]) => [...hs].sort(compareBytes);
	const head: HeadV2 = {
		accountId,
		stateRevision: input.scope.stateRevision + 1,
		previousHeadHash: input.previousHeadHash,
		authEpoch: input.scope.authEpoch,
		observedSessionEpoch: input.sessionEpoch,
		recoveryEpoch: input.scope.recoveryEpoch,
		amkEpoch,
		keyEpoch: input.scope.activeKeyEpoch,
		cryptoGeneration: input.scope.activeGeneration,
		minimumWriteProfile: input.scope.minimumWriteProfile,
		currentEncryptionKeyId: current.keyId,
		currentSigningKeyId: current.keyId,
		historyEventCount: input.scope.historyEventCount,
		keyHistoryRoot: input.scope.keyHistoryRoot,
		credentialDescriptorHashes: sorted(input.credentialHashes),
		slotDescriptorHashes: sorted(input.slotHashes),
		bundleDescriptorHashes: sorted(await Promise.all(secretBundles.map((b) => sha256(b.bundle)))),
		policyVersion: 0,
		migrationId: null,
		issuedAt: now,
		authorityKeyId: aakId,
		authorityEpoch: 1,
		authorityProfileId: PROFILE.accountAuthority,
		authorityPublicKeyDigest: await sha256(aakPublic),
		productDescriptors: descriptors
	};
	const headRaw = encodeHeadV2(head);

	const dataManifest = async (product: Product, signerKeyId: string, signer: openpgp.PrivateKey): Promise<ManifestUpload> => {
		const record = encodeDataManifest({
			accountId,
			product,
			productKeyEpoch: 1,
			manifestId: randomUuid(),
			revision: 1,
			previousManifestHash: null,
			signerKeyId,
			delegationRevision: 1,
			issuedAt: now,
			page: 1,
			pageCount: 1,
			previousPageHash: null,
			entries: []
		});
		return { product, kind: 'data', revision: 1, page: 1, record, signature: await signTranscript(DOMAIN.dataManifest, record, signer) };
	};

	return {
		secretBundles,
		productBundles: [...appSealed.uploads, ...calSealed.uploads],
		identityManifests: [
			{ product: 'app', kind: 'identity', revision: 1, page: 1, record: appManifest.record, signature: appManifest.signature },
			{ product: 'calendar', kind: 'identity', revision: 1, page: 1, record: calManifest.record, signature: calManifest.signature }
		],
		dataManifests: [await dataManifest('app', current.keyId, currentKey), await dataManifest('calendar', calId, cal)],
		activation: {
			head: headRaw,
			mac: await headMac(input.amk, accountId, headRaw),
			authoritySignature: await signTranscript(HEAD_DOMAIN, headRaw, aak),
			legacySignature: await signTranscript(HEAD_DOMAIN, headRaw, currentKey),
			authorityPublicKey: aakPublic,
			delegations: [
				{ record: appDelegation, signature: await signTranscript(DOMAIN.delegation, appDelegation, aak), signingPublicKey: current.publicKeyBytes, recipientPublicKey: current.publicKeyBytes },
				{ record: calDelegation, signature: await signTranscript(DOMAIN.delegation, calDelegation, aak), signingPublicKey: calPublic, recipientPublicKey: calPublic }
			]
		}
	};
}

export function historyKeys(events: Uint8Array[]): HistoryKey[] {
	const out: HistoryKey[] = [];
	for (const raw of events) {
		const e = JSON.parse(new TextDecoder().decode(raw)) as {
			eventType: string;
			keyId: string;
			keyEpoch: number;
			profileId: string;
			publicKeyHash: string;
			eventPayload: { publicKeyBytes?: string };
		};
		if (e.eventType !== 'introduced' || !e.eventPayload.publicKeyBytes) continue;
		out.push({ keyId: e.keyId, keyEpoch: e.keyEpoch, profileId: e.profileId, publicKeyHash: b64decode(e.publicKeyHash), publicKeyBytes: b64decode(e.eventPayload.publicKeyBytes) });
	}
	return out;
}

