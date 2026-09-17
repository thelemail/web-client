import { apiFetch } from './client';

export type ReadDelegationState = 'pending_verification' | 'active' | 'paused' | 'revoked';

export type ForwardDeliveryStatus =
	| 'pending'
	| 'sending'
	| 'queued'
	| 'delivered'
	| 'failed'
	| 'not_forwarded_encrypted'
	| 'not_forwarded_missing_copy'
	| 'not_forwarded_spam'
	| 'loop_suppressed';

export interface ForwardDelivery {
	id: string;
	source: 'inbound' | 'internal';
	status: ForwardDeliveryStatus;
	attempts: number;
	lastError?: string;
	createdAt: string;
	decidedAt?: string | null;
}

export interface ReadDelegation {
	id: string;
	addressId: string;
	address: string;
	label: string;
	destination: string;
	state: ReadDelegationState;
	encryptionKeyFingerprint: string;
	keyAlgorithm: string;
	publicKeyArmored: string;
	notBefore: string;
	destinationVerifiedAt?: string | null;
	pausedAt?: string | null;
	revokedAt?: string | null;
	replacesId?: string | null;
	createdAt: string;
	recent: ForwardDelivery[];
}

export interface CreateReadDelegationRequest {
	label: string;
	publicKeyArmored: string;
	destination: string;
	authorization: string;
	authorizationSignature: string;
}

export interface RotateReadDelegationRequest {
	publicKeyArmored: string;
	authorization: string;
	authorizationSignature: string;
}

const base = (addressId: string) => `/v1/me/addresses/${addressId}/read-delegations`;

export function listReadDelegations(
	addressId: string
): Promise<{ readDelegations: ReadDelegation[] }> {
	return apiFetch(base(addressId));
}

export function createReadDelegation(
	addressId: string,
	body: CreateReadDelegationRequest
): Promise<ReadDelegation> {
	return apiFetch(base(addressId), { method: 'POST', body });
}

export function rotateReadDelegation(
	addressId: string,
	id: string,
	body: RotateReadDelegationRequest
): Promise<ReadDelegation> {
	return apiFetch(`${base(addressId)}/${id}/rotate`, { method: 'POST', body });
}

export function pauseReadDelegation(addressId: string, id: string): Promise<ReadDelegation> {
	return apiFetch(`${base(addressId)}/${id}/pause`, { method: 'POST' });
}

export function resumeReadDelegation(addressId: string, id: string): Promise<ReadDelegation> {
	return apiFetch(`${base(addressId)}/${id}/resume`, { method: 'POST' });
}

export function revokeReadDelegation(addressId: string, id: string): Promise<ReadDelegation> {
	return apiFetch(`${base(addressId)}/${id}`, { method: 'DELETE' });
}

export function resendReadDelegationConfirmation(addressId: string, id: string): Promise<void> {
	return apiFetch(`${base(addressId)}/${id}/resend-confirmation`, { method: 'POST' });
}
