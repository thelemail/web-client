import type { Candidate } from './candidate';
import { candidateBundlesHash, candidateHash, encodeCandidate, parseCandidate } from './candidate';
import { utf8 } from './canonical';
import type { ConversionInput, ProductBundleUpload } from './convert';
import { BUNDLE_BUDGET, deriveImportDedupKey, deriveSearchLeaf, mailEntries, sealPages, unlockAccountKeys } from './convert';
import { bytesEqual, randomUuid, sha256 } from './encoding';
import { randomBytes, SECRET_LEN, transcriptHash } from './envelope';
import { fail } from './errors';
import { parseHeadV2, verifyHeadMac } from './head';
import type { BundleRef } from './manifests';
import { DOMAIN, parseIdentityManifest } from './manifests';
import type { Entry } from './productBundle';
import { ENTRY, openProductBundle } from './productBundle';
import type { StoredBundle } from './read';
import { openRootCandidate, openRootDescriptor, sealRootCandidate } from './secretBundle';

export type MailCandidateInput = Pick<ConversionInput, 'accountId' | 'amk' | 'keyPassword' | 'history' | 'availability' | 'accountKeys' | 'aliasKeys' | 'bundleBudget'> & {
	amkEpoch: number;
};

export interface MailCandidateUpload {
	rootBundleId: string;
	rootBundleRevision: number;
	rootBundle: Uint8Array;
	record: Uint8Array;
	bundles: ProductBundleUpload[];
}

export interface OpenedMailKeys {
	kind: 'candidate' | 'committed';
	root: Uint8Array;
	entries: Entry[];
	digest: Uint8Array;
	currentKeyId: string | null;
	manifest: { manifestId: string; revision: number; hash: Uint8Array; productKeyEpoch: number } | null;
}

export interface StoredCandidate {
	record: Uint8Array;
	rootBundle: Uint8Array;
	bundles: StoredBundle[];
}

export interface StoredCommittedMailKeys {
	head: { raw: Uint8Array; mac: Uint8Array };
	rootBundle: StoredBundle;
	identityManifest: Uint8Array;
	bundles: StoredBundle[];
}

export async function buildMailCandidate(input: MailCandidateInput): Promise<MailCandidateUpload> {
	if (input.amk.length !== SECRET_LEN) fail('malformed', 'amk length');
	const { unlocked } = await unlockAccountKeys(input);
	const root = randomBytes(SECRET_LEN);
	try {
		const forbidden = [input.amk, utf8(input.keyPassword), root];
		const mail = await mailEntries(input, unlocked, forbidden);
		const sealed = await sealPages(root, input.accountId, 'app', mail.entries, forbidden, Math.min(input.bundleBudget ?? BUNDLE_BUDGET, BUNDLE_BUDGET));
		for (const e of mail.entries) e.material?.fill(0);
		const rootBundleId = randomUuid();
		const rootBundle = await sealRootCandidate(
			input.amk,
			{ accountId: input.accountId, amkEpoch: input.amkEpoch, bundleId: rootBundleId, revision: 1 },
			{ product: 'app', productKeyEpoch: 1, productRoot: root, bundlesHash: await candidateBundlesHash(sealed.refs) }
		);
		const record = encodeCandidate({
			accountId: input.accountId,
			product: 'app',
			productKeyEpoch: 1,
			amkEpoch: input.amkEpoch,
			rootBundleId,
			rootBundleRevision: 1,
			rootBundleCiphertextHash: await sha256(rootBundle),
			bundles: sealed.refs
		});
		return { rootBundleId, rootBundleRevision: 1, rootBundle, record, bundles: sealed.uploads };
	} finally {
		root.fill(0);
	}
}

async function openBundles(accountId: string, root: Uint8Array, refs: BundleRef[], stored: StoredBundle[], forbidden: Uint8Array[]): Promise<Entry[]> {
	const entries: Entry[] = [];
	for (const ref of refs) {
		const b = stored.find((x) => x.bundleId === ref.bundleId && x.revision === ref.revision);
		if (!b || b.bundle.length !== ref.byteLength || !bytesEqual(await sha256(b.bundle), ref.ciphertextHash)) {
			fail('context', `bundle ${ref.bundleId}/${ref.revision}`);
		}
		entries.push(
			...(await openProductBundle(root, b.bundle, { accountId, product: 'app', productKeyEpoch: 1, bundleId: ref.bundleId, revision: ref.revision }, forbidden))
		);
	}
	return entries;
}

async function checkLocalSecrets(entries: Entry[], keyPassword: string, accountId: string): Promise<void> {
	const dedup = entries.find((e) => e.purpose === ENTRY.mailImportDedup)?.material;
	const leaf = entries.find((e) => e.purpose === ENTRY.mailSearchIndex)?.material;
	if (!dedup || !bytesEqual(dedup, await deriveImportDedupKey(keyPassword))) fail('context', 'import dedup secret differs');
	if (!leaf || !bytesEqual(leaf, await deriveSearchLeaf(keyPassword, accountId))) fail('context', 'search leaf differs');
}

export async function openMailCandidate(accountId: string, amk: Uint8Array, keyPassword: string, stored: StoredCandidate): Promise<OpenedMailKeys> {
	const c: Candidate = parseCandidate(stored.record);
	if (c.accountId !== accountId || c.product !== 'app' || c.productKeyEpoch !== 1) fail('context', 'candidate belongs elsewhere');
	if (!bytesEqual(await sha256(stored.rootBundle), c.rootBundleCiphertextHash)) fail('context', 'candidate root hash');
	const opened = await openRootCandidate(amk, stored.rootBundle, { accountId, amkEpoch: c.amkEpoch, bundleId: c.rootBundleId, revision: c.rootBundleRevision });
	try {
		if (opened.product !== 'app' || opened.productKeyEpoch !== 1 || !bytesEqual(opened.bundlesHash, await candidateBundlesHash(c.bundles))) {
			fail('context', 'candidate root does not name these bundles');
		}
		const entries = await openBundles(accountId, opened.productRoot, c.bundles, stored.bundles, [amk, utf8(keyPassword)]);
		await checkLocalSecrets(entries, keyPassword, accountId);
		return { kind: 'candidate', root: opened.productRoot.slice(), entries, digest: await candidateHash(stored.record), currentKeyId: null, manifest: null };
	} finally {
		opened.productRoot.fill(0);
	}
}

export async function openCommittedMailKeys(accountId: string, amk: Uint8Array, keyPassword: string, stored: StoredCommittedMailKeys): Promise<OpenedMailKeys> {
	await verifyHeadMac(amk, accountId, stored.head.raw, stored.head.mac);
	const head = parseHeadV2(stored.head.raw);
	const d = head.productDescriptors.find((x) => x.product === 'app');
	if (head.accountId !== accountId || !d) fail('context', 'head does not commit mail keys');
	if (stored.rootBundle.bundleId !== d.rootBundleId || stored.rootBundle.revision !== d.rootBundleRevision || !bytesEqual(await sha256(stored.rootBundle.bundle), d.rootBundleCiphertextHash)) {
		fail('context', 'root descriptor');
	}
	const root = await openRootDescriptor(amk, stored.rootBundle.bundle, { accountId, amkEpoch: head.amkEpoch, bundleId: d.rootBundleId, revision: d.rootBundleRevision });
	try {
		const manifestHash = await transcriptHash(DOMAIN.identityManifest, stored.identityManifest);
		if (
			root.product !== 'app' ||
			root.productKeyEpoch !== d.productKeyEpoch ||
			d.productKeyEpoch !== 1 ||
			root.identityManifestId !== d.identityManifestId ||
			root.identityManifestRevision !== d.identityManifestRevision ||
			!bytesEqual(root.identityManifestHash, d.identityManifestHash) ||
			!bytesEqual(manifestHash, d.identityManifestHash)
		) {
			fail('context', 'root descriptor does not match the head');
		}
		const m = parseIdentityManifest(stored.identityManifest);
		if (m.accountId !== accountId || m.product !== 'app' || m.manifestId !== d.identityManifestId || m.revision !== d.identityManifestRevision) {
			fail('context', 'identity manifest');
		}
		const entries = await openBundles(accountId, root.productRoot, m.bundles, stored.bundles, [amk, utf8(keyPassword)]);
		for (const k of m.identityKeys) {
			const e = entries.find((x) => x.keyId === k.keyId);
			if (!e || e.availability !== k.privateAvailability || e.keyEpoch !== k.keyEpoch) fail('context', `identity key ${k.keyId}`);
		}
		await checkLocalSecrets(entries, keyPassword, accountId);
		return {
			kind: 'committed',
			root: root.productRoot.slice(),
			entries,
			digest: manifestHash,
			currentKeyId: head.currentSigningKeyId,
			manifest: { manifestId: m.manifestId, revision: m.revision, hash: manifestHash, productKeyEpoch: d.productKeyEpoch }
		};
	} finally {
		root.productRoot.fill(0);
	}
}

export function wipeOpenedMailKeys(opened: OpenedMailKeys): void {
	opened.root.fill(0);
	for (const e of opened.entries) e.material?.fill(0);
}
