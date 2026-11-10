import { decodeCanonical, encodeCanonical } from './canonical';
import { b64encode } from './encoding';
import { transcriptHash } from './envelope';
import { fail } from './errors';
import { array, exact, hash, id, int, MAX_RECORD_BYTES, revisionKey, sortedUnique, str, tupleKey } from './fields';
import type { BundleRef } from './manifests';
import type { Product } from './productBundle';
import { isProduct } from './productBundle';
import { PROFILE } from './profiles';

const TYPE = 'thelemail-product-candidate/v1';
const DOMAIN = 'thelemail/product-candidate/v1';
const BUNDLES_DOMAIN = 'thelemail/product-candidate-bundles/v1';
const MAX_BYTES = 256 << 10;
const MAX_BUNDLES = 64;
const FIELDS = ['accountId', 'amkEpoch', 'bundles', 'product', 'productKeyEpoch', 'rootBundleCiphertextHash', 'rootBundleId', 'rootBundleRevision', 'type'];
const BUNDLE_REF_FIELDS = ['bundleId', 'byteLength', 'ciphertextHash', 'profileId', 'revision'];

export interface Candidate {
	accountId: string;
	product: Product;
	productKeyEpoch: number;
	amkEpoch: number;
	rootBundleId: string;
	rootBundleRevision: number;
	rootBundleCiphertextHash: Uint8Array;
	bundles: BundleRef[];
}

function checkBundles(refs: BundleRef[]): void {
	if (refs.length === 0 || refs.length > MAX_BUNDLES) fail('malformed', 'candidate bundles');
	sortedUnique(refs, (b) => tupleKey(b.bundleId, revisionKey(b.revision)));
	for (const b of refs) {
		if (b.byteLength < 1 || b.byteLength > MAX_RECORD_BYTES || b.profileId !== PROFILE.productBundleV1 || b.ciphertextHash.length !== 32) {
			fail('malformed', 'bundle reference');
		}
	}
}

function refsJson(refs: BundleRef[]) {
	return refs.map((b) => ({
		bundleId: b.bundleId,
		revision: b.revision,
		ciphertextHash: b64encode(b.ciphertextHash),
		byteLength: b.byteLength,
		profileId: b.profileId
	}));
}

export function candidateBundlesHash(refs: BundleRef[]): Promise<Uint8Array> {
	checkBundles(refs);
	return transcriptHash(BUNDLES_DOMAIN, encodeCanonical(refsJson(refs)));
}

export function parseCandidate(raw: Uint8Array): Candidate {
	if (raw.length > MAX_BYTES) fail('too-large');
	const o = exact(decodeCanonical(raw, MAX_BYTES), FIELDS);
	if (str(o, 'type') !== TYPE) fail('malformed', 'type');
	const product = str(o, 'product');
	if (!isProduct(product)) fail('malformed', 'product');
	const c: Candidate = {
		accountId: id(o, 'accountId'),
		product,
		productKeyEpoch: int(o, 'productKeyEpoch', 1),
		amkEpoch: int(o, 'amkEpoch'),
		rootBundleId: id(o, 'rootBundleId'),
		rootBundleRevision: int(o, 'rootBundleRevision', 1),
		rootBundleCiphertextHash: hash(o, 'rootBundleCiphertextHash'),
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
	checkBundles(c.bundles);
	return c;
}

export function encodeCandidate(c: Candidate): Uint8Array {
	const raw = encodeCanonical({
		type: TYPE,
		accountId: c.accountId,
		product: c.product,
		productKeyEpoch: c.productKeyEpoch,
		amkEpoch: c.amkEpoch,
		rootBundleId: c.rootBundleId,
		rootBundleRevision: c.rootBundleRevision,
		rootBundleCiphertextHash: b64encode(c.rootBundleCiphertextHash),
		bundles: refsJson(c.bundles)
	});
	parseCandidate(raw);
	return raw;
}

export function candidateHash(raw: Uint8Array): Promise<Uint8Array> {
	return transcriptHash(DOMAIN, raw);
}
