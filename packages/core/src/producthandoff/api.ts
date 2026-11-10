import { ApiCallError, type ErrorEnvelope } from '$core/api/types';
import type { ProductKeysProduct, ProductKeysResponse } from '$core/api/productKeys';

export interface DescriptorResponse {
	requestId: string;
	descriptor: string;
	descriptorDigest: string;
	expiresAt: string;
}

export interface RedemptionResponse {
	accountId: string;
	sessionId: string;
	accessToken: string;
	expiresIn: number;
	adoptBy: string;
	envelope: string;
	serverHalf: string | null;
}

export interface AcknowledgementResponse {
	accountId: string;
	sessionId: string;
	cookieInstalled: boolean;
	csrfToken?: string;
}

export interface AdoptionResponse {
	status: 'created' | 'authorized' | 'redeemed' | 'acknowledged' | 'expired' | 'cancelled';
	sessionId: string;
	active: boolean;
}

interface HostCall {
	method?: 'GET' | 'POST';
	body?: unknown;
	csrf?: string;
	token?: string;
}

export async function hostFetch<T>(path: string, call: HostCall = {}): Promise<T> {
	const headers: Record<string, string> = {};
	if (call.body !== undefined) headers['Content-Type'] = 'application/json';
	if (call.csrf) headers['X-CSRF-Token'] = call.csrf;
	if (call.token) headers['Authorization'] = `Bearer ${call.token}`;
	const resp = await fetch(window.location.origin + path, {
		method: call.method ?? 'GET',
		credentials: 'same-origin',
		cache: 'no-store',
		referrerPolicy: 'no-referrer',
		headers,
		body: call.body === undefined ? undefined : JSON.stringify(call.body)
	});
	if (resp.status === 204) return undefined as T;
	const json = (resp.headers.get('content-type') ?? '').includes('application/json') ? await resp.json().catch(() => null) : null;
	if (!resp.ok) throw new ApiCallError(resp.status, json as ErrorEnvelope | null, (json as ErrorEnvelope | null)?.error?.message ?? `HTTP ${resp.status}`);
	return json as T;
}

export function bootstrap(): Promise<{ csrfToken: string }> {
	return hostFetch('/v1/auth/handoffs/bootstrap');
}

export function createRequest(
	body: {
		state: string;
		codeChallenge: string;
		codeChallengeMethod: 'S256';
		receiverPublicKey: string;
		expectedAccountId: string | null;
		existingSessionId: string | null;
		requireFreshAuth?: boolean;
	},
	csrf: string
): Promise<DescriptorResponse> {
	return hostFetch('/v1/auth/handoffs/requests', { method: 'POST', body, csrf });
}

export function redeem(body: { requestId: string; code: string; state: string; verifier: string; remember: boolean }, csrf: string): Promise<RedemptionResponse> {
	return hostFetch('/v1/auth/handoffs/redeem', { method: 'POST', body, csrf });
}

export function acknowledge(requestId: string, token: string, body: { envelopeDigest: string; identityManifestHash: string }): Promise<AcknowledgementResponse> {
	return hostFetch(`/v1/auth/handoffs/${requestId}/ack`, { method: 'POST', body, token });
}

export function adoption(requestId: string, token: string): Promise<AdoptionResponse> {
	return hostFetch(`/v1/auth/handoffs/${requestId}/adoption`, { token });
}

export function cancel(requestId: string, csrf: string): Promise<void> {
	return hostFetch(`/v1/auth/handoffs/${requestId}/cancel`, { method: 'POST', csrf });
}

export function productKeys(product: ProductKeysProduct, token: string): Promise<ProductKeysResponse> {
	return hostFetch(`/v1/me/product-keys/${product}`, { token });
}

export function productBundle(product: ProductKeysProduct, bundleId: string, revision: number, token: string): Promise<{ bundle: string }> {
	return hostFetch(`/v1/me/product-keys/${product}/bundles/${bundleId}/revisions/${revision}`, { token });
}
