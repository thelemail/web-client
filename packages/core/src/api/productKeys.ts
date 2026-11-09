import { apiFetch } from './client';

export type ProductKeysProduct = 'app' | 'calendar';

export interface CryptoAccountHead {
	version: number;
	stateRevision: number;
	head: string;
	headHash: string;
	previousHeadHash: string | null;
	authoritySignature: string | null;
	legacySignature: string | null;
	transitionSignature: string | null;
	mac: string;
}

export interface CryptoStateResponse {
	scope: {
		scopeType: string;
		scopeId: string;
		stateRevision: number;
		activeKeyEpoch: number;
		activeGeneration: number;
		authEpoch: number;
		recoveryEpoch: number;
		amkEpoch: number;
		minimumWriteProfile: string | null;
		historyEventCount: number;
		keyHistoryRoot: string;
	};
	sessionEpoch: number;
	head: CryptoAccountHead | null;
	credentials: { credentialId: string; method: string; state: string; recordHash: string | null }[];
	slots: { slotId: string; kind: string; state: string; wrapperHash: string }[];
	bundles: { bundleId: string; bundleRevision: number; amkEpoch: number; profileId: string; kind: string | null; sizeBytes: number; bytesHash: string }[];
	keys: { keyId: string; privateState: string }[];
	history: { start: number; end: number; predecessor: string; events: string[]; nextCursor: string | null };
	features: { productKeys: boolean };
}

export interface ProductManifestPage {
	kind: 'identity' | 'data';
	revision: number;
	page: number;
	pageCount: number;
	record: string;
	signature: string;
	recordHash: string;
}

export interface ProductKeysResponse {
	product: ProductKeysProduct;
	head: CryptoAccountHead | null;
	authorityKey: { authorityEpoch: number; keyId: string; profileId: string; publicKey: string; publicKeyDigest: string } | null;
	identityManifest: ProductManifestPage | null;
	dataManifest: ProductManifestPage[];
	delegation: {
		delegationRevision: number;
		record: string;
		signature: string;
		delegationHash: string;
		signingPublicKey: string;
		recipientPublicKey: string;
	} | null;
}

export interface ActivateCryptoHeadRequest {
	head: string;
	mac: string;
	authoritySignature: string;
	legacySignature: string | null;
	transitionSignature: string | null;
	authorityPublicKey: string | null;
	delegations: { record: string; signature: string; signingPublicKey: string; recipientPublicKey: string }[];
}

export function getCryptoState(accountId: string, cursor?: string): Promise<CryptoStateResponse> {
	const query = cursor ? `?limit=128&cursor=${encodeURIComponent(cursor)}` : '?limit=128';
	return apiFetch(`/v1/me/crypto-state${query}`, { accountId });
}

export function getSecretBundle(accountId: string, bundleId: string, revision: number): Promise<{ bundleId: string; bundleRevision: number; kind: string | null; bundle: string }> {
	return apiFetch(`/v1/me/crypto-state/bundles/${bundleId}/revisions/${revision}`, { accountId });
}

export function putSecretBundle(accountId: string, bundleId: string, revision: number, kind: string, bundle: string): Promise<void> {
	return apiFetch(`/v1/me/crypto-state/bundles/${bundleId}/revisions/${revision}`, { method: 'PUT', body: { kind, bundle }, accountId });
}

export function activateCryptoHead(accountId: string, body: ActivateCryptoHeadRequest): Promise<CryptoAccountHead> {
	return apiFetch('/v1/me/crypto-state/heads', { method: 'POST', body, accountId });
}

export function getProductKeys(accountId: string, product: ProductKeysProduct): Promise<ProductKeysResponse> {
	return apiFetch(`/v1/me/product-keys/${product}`, { accountId });
}

export function getProductBundle(accountId: string, product: ProductKeysProduct, bundleId: string, revision: number): Promise<{ bundle: string }> {
	return apiFetch(`/v1/me/product-keys/${product}/bundles/${bundleId}/revisions/${revision}`, { accountId });
}

export function putProductBundle(accountId: string, product: ProductKeysProduct, bundleId: string, revision: number, bundle: string): Promise<void> {
	return apiFetch(`/v1/me/product-keys/${product}/bundles/${bundleId}/revisions/${revision}`, { method: 'PUT', body: { bundle }, accountId });
}

export function putProductManifest(
	accountId: string,
	product: ProductKeysProduct,
	kind: 'identity' | 'data',
	revision: number,
	page: number,
	record: string,
	signature: string
): Promise<void> {
	return apiFetch(`/v1/me/product-keys/${product}/manifests/${kind}/revisions/${revision}/pages/${page}`, {
		method: 'PUT',
		body: { record, signature },
		accountId
	});
}
