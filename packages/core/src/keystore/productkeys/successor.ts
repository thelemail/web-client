import * as openpgp from 'openpgp';
import { utf8 } from './canonical';
import type { ConversionInput, DelegationUpload, HistoryKey, ManifestUpload, ProductBundleUpload, SecretBundleUpload } from './convert';
import { BUNDLE_BUDGET, mailEntries, sealPages, unlockAccountKeys } from './convert';
import { bytesEqual, compareBytes, keyId, sha256 } from './encoding';
import { transcriptHash } from './envelope';
import { fail } from './errors';
import { formatTime } from './fields';
import type { HeadV2, ProductDescriptor } from './head';
import { encodeHeadV2, HEAD_DOMAIN, headHash, headMac, parseHeadV2, verifyHeadMac } from './head';
import type { IdentityKey } from './manifests';
import { DOMAIN, encodeDataManifest, encodeDelegation, encodeIdentityManifest, parseDelegation, parseIdentityManifest, verifyDataManifestPages } from './manifests';
import { fingerprintBytes, signTranscript } from './pgp';
import type { ProductReadInput, StoredBundle } from './read';
import { openAuthority, openRootDescriptor, sealRootDescriptor } from './secretBundle';

export interface SuccessorInput extends Pick<
	ConversionInput,
	'accountId' | 'amk' | 'keyPassword' | 'scope' | 'sessionEpoch' | 'credentialHashes' | 'slotHashes' | 'availability' | 'accountKeys' | 'aliasKeys' | 'now' | 'bundleBudget'
> {
	history: HistoryKey[];
	previous: { raw: Uint8Array; mac: Uint8Array };
	secretBundles: StoredBundle[];
	products: ProductReadInput[];
}

export interface SuccessorOutput {
	secretBundles: SecretBundleUpload[];
	productBundles: ProductBundleUpload[];
	identityManifests: ManifestUpload[];
	dataManifests: ManifestUpload[];
	activation: {
		head: Uint8Array;
		mac: Uint8Array;
		authoritySignature: Uint8Array;
		delegations: DelegationUpload[];
	};
}

function sameKeys(a: IdentityKey[], b: IdentityKey[]): boolean {
	if (a.length !== b.length) return false;
	const key = (k: IdentityKey) => `${k.keyId}|${k.usage}|${k.profileId}|${k.keyEpoch}|${k.privateAvailability}`;
	const left = [...a].sort((x, y) => (x.keyId < y.keyId ? -1 : 1));
	const right = [...b].sort((x, y) => (x.keyId < y.keyId ? -1 : 1));
	return left.every((k, i) => key(k) === key(right[i]) && bytesEqual(k.publicKeyDigest, right[i].publicKeyDigest));
}

async function authorityFor(input: SuccessorInput, prev: HeadV2, committed: Set<string>): Promise<openpgp.PrivateKey> {
	for (const b of input.secretBundles) {
		if (!committed.has((await sha256(b.bundle)).join(','))) continue;
		try {
			const a = await openAuthority(input.amk, b.bundle, { accountId: input.accountId, amkEpoch: prev.amkEpoch, bundleId: b.bundleId, revision: b.revision });
			if (a.authorityKeyId !== prev.authorityKeyId || a.authorityEpoch !== prev.authorityEpoch) continue;
			const key = await openpgp.readPrivateKey({ binaryKey: a.secretKey.slice() });
			a.secretKey.fill(0);
			return key;
		} catch (err) {
			if ((err as { code?: string }).code !== 'context') throw err;
		}
	}
	fail('context', 'authority bundle is missing');
}

export async function buildSuccessor(input: SuccessorInput): Promise<SuccessorOutput | null> {
	const accountId = input.accountId;
	await verifyHeadMac(input.amk, accountId, input.previous.raw, input.previous.mac);
	const prev = parseHeadV2(input.previous.raw);
	if (prev.accountId !== accountId) fail('context', 'head belongs to another account');
	if (prev.stateRevision !== input.scope.stateRevision) fail('context', 'head is not the active head');
	if (prev.amkEpoch !== input.scope.amkEpoch) fail('context', 'account master key changed');
	const now = formatTime(input.now ?? new Date());

	const committed = new Set(prev.bundleDescriptorHashes.map((h) => h.join(',')));
	const authority = await authorityFor(input, prev, committed);
	const appDescriptor = prev.productDescriptors.find((d) => d.product === 'app');
	const app = input.products.find((p) => p.product === 'app');
	if (!appDescriptor || !app) fail('context', 'app product is missing');
	const rootBundle = input.secretBundles.find((b) => b.bundleId === appDescriptor.rootBundleId && b.revision === appDescriptor.rootBundleRevision);
	if (!rootBundle || !bytesEqual(await sha256(rootBundle.bundle), appDescriptor.rootBundleCiphertextHash)) fail('context', 'app root descriptor');
	const root = await openRootDescriptor(input.amk, rootBundle.bundle, {
		accountId,
		amkEpoch: prev.amkEpoch,
		bundleId: appDescriptor.rootBundleId,
		revision: appDescriptor.rootBundleRevision
	});

	try {
		const { unlocked, current: currentKey } = await unlockAccountKeys(input);
		const currentId = keyId(accountId, fingerprintBytes(currentKey));
		const current = input.history.find((h) => h.keyId === currentId);
		if (!current) fail('context', 'current key is not in key history');
		const forbidden = [input.amk, utf8(input.keyPassword), root.productRoot];
		const mail = await mailEntries(input, unlocked, forbidden);

		const prevManifest = parseIdentityManifest(app.identityManifest.record);
		const prevDelegation = parseDelegation(app.delegation.record);
		const rotated = prevDelegation.signingKeyId !== currentId;
		const appChanged = rotated || !sameKeys(mail.keys, prevManifest.identityKeys);

		const out: SuccessorOutput = {
			secretBundles: [],
			productBundles: [],
			identityManifests: [],
			dataManifests: [],
			activation: { head: new Uint8Array(), mac: new Uint8Array(), authoritySignature: new Uint8Array(), delegations: [] }
		};
		let descriptors: ProductDescriptor[] = prev.productDescriptors;
		let bundleHashes = prev.bundleDescriptorHashes;

		if (appChanged) {
			let delegation = app.delegation.record;
			if (rotated) {
				delegation = encodeDelegation({
					...prevDelegation,
					signingKeyId: current.keyId,
					signingProfileId: current.profileId,
					signingPublicKeyDigest: current.publicKeyHash,
					recipientKeyId: current.keyId,
					recipientProfileId: current.profileId,
					recipientPublicKeyDigest: current.publicKeyHash,
					issuedAt: now,
					delegationRevision: prevDelegation.delegationRevision + 1,
					previousDelegationHash: await transcriptHash(DOMAIN.delegation, app.delegation.record)
				});
				out.activation.delegations.push({
					record: delegation,
					signature: await signTranscript(DOMAIN.delegation, delegation, authority),
					signingPublicKey: current.publicKeyBytes,
					recipientPublicKey: current.publicKeyBytes
				});
			}
			const delegationHash = await transcriptHash(DOMAIN.delegation, delegation);
			const budget = Math.min(input.bundleBudget ?? BUNDLE_BUDGET, BUNDLE_BUDGET);
			const sealed = await sealPages(root.productRoot, accountId, 'app', mail.entries, forbidden, budget);
			out.productBundles.push(...sealed.uploads);

			const manifestRevision = prevManifest.revision + 1;
			const manifest = encodeIdentityManifest({
				...prevManifest,
				revision: manifestRevision,
				previousManifestHash: await transcriptHash(DOMAIN.identityManifest, app.identityManifest.record),
				delegationHash,
				issuedAt: now,
				identityKeys: mail.keys,
				bundles: sealed.refs
			});
			out.identityManifests.push({ product: 'app', kind: 'identity', revision: manifestRevision, page: 1, record: manifest, signature: await signTranscript(DOMAIN.identityManifest, manifest, authority) });
			const manifestHash = await transcriptHash(DOMAIN.identityManifest, manifest);

			const rootRevision = appDescriptor.rootBundleRevision + 1;
			const rootSealed = await sealRootDescriptor(
				input.amk,
				{ accountId, amkEpoch: prev.amkEpoch, bundleId: appDescriptor.rootBundleId, revision: rootRevision },
				{
					product: 'app',
					productKeyEpoch: appDescriptor.productKeyEpoch,
					productRoot: root.productRoot,
					identityManifestId: prevManifest.manifestId,
					identityManifestRevision: manifestRevision,
					identityManifestHash: manifestHash
				}
			);
			out.secretBundles.push({ bundleId: appDescriptor.rootBundleId, revision: rootRevision, kind: 'product-root', bundle: rootSealed });
			const rootHash = await sha256(rootSealed);
			descriptors = prev.productDescriptors.map((d) =>
				d.product === 'app'
					? { ...d, rootBundleRevision: rootRevision, rootBundleCiphertextHash: rootHash, identityManifestRevision: manifestRevision, identityManifestHash: manifestHash, delegationHash }
					: d
			);
			bundleHashes = [...prev.bundleDescriptorHashes.filter((h) => !bytesEqual(h, appDescriptor.rootBundleCiphertextHash)), rootHash];

			if (rotated && app.dataManifest.length > 0) {
				const pages = await verifyDataManifestPages(app.dataManifest.map((p) => p.record));
				const revision = pages[0].revision + 1;
				const previousManifestHash = await transcriptHash(DOMAIN.dataManifest, app.dataManifest[app.dataManifest.length - 1].record);
				let previousPageHash: Uint8Array | null = null;
				for (let i = 0; i < pages.length; i++) {
					const record = encodeDataManifest({
						...pages[i],
						revision,
						previousManifestHash,
						signerKeyId: current.keyId,
						delegationRevision: prevDelegation.delegationRevision + 1,
						issuedAt: now,
						previousPageHash
					});
					out.dataManifests.push({ product: 'app', kind: 'data', revision, page: i + 1, record, signature: await signTranscript(DOMAIN.dataManifest, record, currentKey) });
					previousPageHash = await transcriptHash(DOMAIN.dataManifest, record);
				}
			}
		}

		const sorted = (hs: Uint8Array[]) => [...hs].sort(compareBytes);
		const fields: HeadV2 = {
			...prev,
			authEpoch: input.scope.authEpoch,
			observedSessionEpoch: input.sessionEpoch,
			recoveryEpoch: input.scope.recoveryEpoch,
			keyEpoch: input.scope.activeKeyEpoch,
			cryptoGeneration: input.scope.activeGeneration,
			minimumWriteProfile: input.scope.minimumWriteProfile,
			currentEncryptionKeyId: current.keyId,
			currentSigningKeyId: current.keyId,
			historyEventCount: input.scope.historyEventCount,
			keyHistoryRoot: input.scope.keyHistoryRoot,
			credentialDescriptorHashes: sorted(input.credentialHashes),
			slotDescriptorHashes: sorted(input.slotHashes),
			bundleDescriptorHashes: sorted(bundleHashes),
			productDescriptors: descriptors
		};
		if (!appChanged && bytesEqual(encodeHeadV2(fields), input.previous.raw)) return null;

		const head = encodeHeadV2({ ...fields, stateRevision: prev.stateRevision + 1, previousHeadHash: await headHash(input.previous.raw), issuedAt: now });
		out.activation.head = head;
		out.activation.mac = await headMac(input.amk, accountId, head);
		out.activation.authoritySignature = await signTranscript(HEAD_DOMAIN, head, authority);
		return out;
	} finally {
		root.productRoot.fill(0);
	}
}
