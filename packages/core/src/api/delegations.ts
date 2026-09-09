import { apiFetch } from './client';

export interface SigningDelegation {
	id: string;
	addressId: string;
	address: string;
	label: string;
	signerFingerprint: string;
	keyAlgorithm: string;
	publicKeyArmored: string;
	notBefore: string;
	notAfter: string;
	revokedAt?: string | null;
	revocationServeUntil?: string | null;
	createdAt: string;
	statement?: string;
	statementSignature?: string;
	tlogProof?: string;
}

export interface CreateSigningDelegationRequest {
	label: string;
	publicKeyArmored: string;
	revokedPublicKeyArmored: string;
	keyAlgorithm: string;
}

export function listSigningDelegations(
	addressId: string
): Promise<{ delegations: SigningDelegation[] }> {
	return apiFetch(`/v1/me/addresses/${addressId}/delegations`);
}

export function createSigningDelegation(
	addressId: string,
	body: CreateSigningDelegationRequest
): Promise<SigningDelegation> {
	return apiFetch(`/v1/me/addresses/${addressId}/delegations`, { method: 'POST', body });
}

export function revokeSigningDelegation(
	addressId: string,
	delegationId: string
): Promise<SigningDelegation> {
	return apiFetch(`/v1/me/addresses/${addressId}/delegations/${delegationId}`, {
		method: 'DELETE'
	});
}
