import * as openpgp from 'openpgp';
import { bytesEqual, keyId, sha256 } from './encoding';
import { transcriptHash } from './envelope';
import { fail } from './errors';
import type { HeadSignatures } from './head';
import { HEAD_DOMAIN, parseHeadV2, verifyBootstrap, verifyHeadMac } from './head';
import { DOMAIN, parseDelegation, parseIdentityManifest, verifyDataManifestPages } from './manifests';
import { fingerprintBytes, parsePublicKey, validateProfile, verifyTranscript } from './pgp';
import type { Availability, Product } from './productBundle';
import { ENTRY, openProductBundle } from './productBundle';
import { PROFILE } from './profiles';
import { openAuthority, openRootDescriptor } from './secretBundle';
import { deriveImportDedupKey, deriveSearchLeaf } from './convert';

export interface StoredBundle {
	bundleId: string;
	revision: number;
	bundle: Uint8Array;
}

export interface SignedRecord {
	record: Uint8Array;
	signature: Uint8Array;
}

export interface ProductReadInput {
	product: Product;
	identityManifest: SignedRecord;
	delegation: SignedRecord & { signingPublicKey: Uint8Array };
	dataManifest: SignedRecord[];
	bundles: StoredBundle[];
}

export interface ReadInput {
	accountId: string;
	amk: Uint8Array;
	keyPassword: string;
	mailKeys: openpgp.Key[];
	authorityKey: Uint8Array;
	head: { raw: Uint8Array; mac: Uint8Array; previousHeadHash: Uint8Array | null } & HeadSignatures;
	secretBundles: StoredBundle[];
	products: ProductReadInput[];
}

export interface ReadEntry {
	keyId: string;
	scopeId: string;
	purpose: string;
	keyEpoch: number;
	availability: Availability;
	held: boolean;
}

export interface ReadResult {
	authorityKeyId: string;
	stateRevision: number;
	products: { product: Product; entries: ReadEntry[]; dataManifestPages: number }[];
	importDedupMatches: boolean;
	searchLeafMatches: boolean;
}

function find(bundles: StoredBundle[], bundleId: string, revision: number): StoredBundle {
	const b = bundles.find((x) => x.bundleId === bundleId && x.revision === revision);
	if (!b) fail('context', `bundle ${bundleId}/${revision} is missing`);
	return b;
}

function mailKey(input: ReadInput, id: string): openpgp.Key {
	const key = input.mailKeys.find((k) => keyId(input.accountId, fingerprintBytes(k)) === id);
	if (!key) fail('context', `mail key ${id} is not published`);
	return key;
}

export async function readProductKeys(input: ReadInput): Promise<ReadResult> {
	const authority = await parsePublicKey(input.authorityKey);
	await validateProfile(PROFILE.accountAuthority, authority);
	if (input.head.legacy) {
		await verifyBootstrap(input.head.raw, input.head.previousHeadHash, input.head, authority, mailKey(input, parseHeadV2(input.head.raw).currentSigningKeyId));
	} else if (input.head.authority) {
		await verifyTranscript(HEAD_DOMAIN, input.head.raw, input.head.authority, authority);
	} else {
		fail('transition', 'head has no authority signature');
	}
	await verifyHeadMac(input.amk, input.accountId, input.head.raw, input.head.mac);
	const head = parseHeadV2(input.head.raw);
	if (head.accountId !== input.accountId) fail('context', 'head belongs to another account');
	if (keyId(input.accountId, fingerprintBytes(authority)) !== head.authorityKeyId) fail('transition', 'authority key does not match the head');

	const committed = new Set<string>();
	const accounted = new Set<string>();
	for (const h of head.bundleDescriptorHashes) committed.add(h.join(','));
	const hashOf = async (b: Uint8Array) => (await sha256(b)).join(',');

	let authorityFound = false;
	for (const b of input.secretBundles) {
		const h = await hashOf(b.bundle);
		if (!committed.has(h)) continue;
		try {
			const a = await openAuthority(input.amk, b.bundle, { accountId: input.accountId, amkEpoch: head.amkEpoch, bundleId: b.bundleId, revision: b.revision });
			const secret = await openpgp.readPrivateKey({ binaryKey: a.secretKey });
			if (a.authorityKeyId !== head.authorityKeyId || a.authorityEpoch !== head.authorityEpoch || !bytesEqual(fingerprintBytes(secret), fingerprintBytes(authority))) {
				fail('context', 'authority bundle does not hold the head authority key');
			}
			authorityFound = true;
			accounted.add(h);
		} catch (err) {
			if ((err as { code?: string }).code !== 'context') throw err;
		}
	}
	if (!authorityFound) fail('context', 'authority bundle is missing');

	const forbidden = [input.amk, new TextEncoder().encode(input.keyPassword)];
	const result: ReadResult = { authorityKeyId: head.authorityKeyId, stateRevision: head.stateRevision, products: [], importDedupMatches: false, searchLeafMatches: false };
	for (const d of head.productDescriptors) {
		const p = input.products.find((x) => x.product === d.product);
		if (!p) fail('context', `${d.product} is missing`);
		const rootBundle = find(input.secretBundles, d.rootBundleId, d.rootBundleRevision);
		const rootHash = await sha256(rootBundle.bundle);
		if (!bytesEqual(rootHash, d.rootBundleCiphertextHash)) fail('context', 'root descriptor hash');
		accounted.add(rootHash.join(','));
		const root = await openRootDescriptor(input.amk, rootBundle.bundle, { accountId: input.accountId, amkEpoch: head.amkEpoch, bundleId: d.rootBundleId, revision: d.rootBundleRevision });
		if (
			root.product !== d.product ||
			root.productKeyEpoch !== d.productKeyEpoch ||
			root.identityManifestId !== d.identityManifestId ||
			root.identityManifestRevision !== d.identityManifestRevision ||
			!bytesEqual(root.identityManifestHash, d.identityManifestHash)
		) {
			fail('context', 'root descriptor does not match the head');
		}
		if (!bytesEqual(await transcriptHash(DOMAIN.identityManifest, p.identityManifest.record), d.identityManifestHash)) fail('context', 'identity manifest hash');
		await verifyTranscript(DOMAIN.identityManifest, p.identityManifest.record, p.identityManifest.signature, authority);
		const manifest = parseIdentityManifest(p.identityManifest.record);
		if (manifest.accountId !== input.accountId || manifest.authorityKeyId !== head.authorityKeyId || manifest.authorityEpoch !== head.authorityEpoch || !bytesEqual(manifest.delegationHash, d.delegationHash)) {
			fail('context', 'identity manifest does not match the head');
		}
		if (!bytesEqual(await transcriptHash(DOMAIN.delegation, p.delegation.record), d.delegationHash)) fail('context', 'delegation hash');
		await verifyTranscript(DOMAIN.delegation, p.delegation.record, p.delegation.signature, authority);
		const delegation = parseDelegation(p.delegation.record);
		if (!bytesEqual(await sha256(p.delegation.signingPublicKey), delegation.signingPublicKeyDigest)) fail('context', 'delegated key digest');

		const entries: ReadEntry[] = [];
		for (const ref of manifest.bundles) {
			const stored = find(p.bundles, ref.bundleId, ref.revision);
			if (stored.bundle.length !== ref.byteLength || !bytesEqual(await sha256(stored.bundle), ref.ciphertextHash)) fail('context', 'bundle hash');
			const opened = await openProductBundle(root.productRoot, stored.bundle, { accountId: input.accountId, product: d.product, productKeyEpoch: d.productKeyEpoch, bundleId: ref.bundleId, revision: ref.revision }, forbidden);
			for (const e of opened) {
				entries.push({ keyId: e.keyId, scopeId: e.scopeId, purpose: e.purpose, keyEpoch: e.keyEpoch, availability: e.availability, held: e.material !== null });
				if (e.purpose === ENTRY.mailImportDedup && e.material) {
					result.importDedupMatches = bytesEqual(e.material, await deriveImportDedupKey(input.keyPassword));
				}
				if (e.purpose === ENTRY.mailSearchIndex && e.material) {
					result.searchLeafMatches = bytesEqual(e.material, await deriveSearchLeaf(input.keyPassword, input.accountId));
				}
			}
		}
		for (const k of manifest.identityKeys) {
			const e = entries.find((x) => x.keyId === k.keyId);
			if (!e || e.availability !== k.privateAvailability || e.keyEpoch !== k.keyEpoch) fail('context', `identity key ${k.keyId} has no matching entry`);
		}

		let dataManifestPages = 0;
		if (p.dataManifest.length > 0) {
			const pages = await verifyDataManifestPages(p.dataManifest.map((x) => x.record));
			const signer = d.product === 'app' ? mailKey(input, delegation.signingKeyId) : await parsePublicKey(p.delegation.signingPublicKey);
			if (keyId(input.accountId, fingerprintBytes(signer)) !== delegation.signingKeyId || pages[0].signerKeyId !== delegation.signingKeyId) {
				fail('context', 'data manifest signer');
			}
			for (const page of p.dataManifest) await verifyTranscript(DOMAIN.dataManifest, page.record, page.signature, signer);
			dataManifestPages = pages.length;
		}
		result.products.push({ product: d.product, entries, dataManifestPages });
	}
	if (accounted.size !== committed.size) fail('context', 'head commits bundles that were not read');
	return result;
}
