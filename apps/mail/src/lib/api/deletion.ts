import { apiFetch } from './client';
import type {
	AccountDeletionOpaqueConfirmRequest,
	AccountDeletionOpaqueInitRequest,
	AccountDeletionOpaqueInitResponse,
	DeletionConfirmRequest,
	DeletionConfirmResponse,
	DeletionInitResponse
} from './types';

export function initDeletion(accountId?: string) {
	return apiFetch<DeletionInitResponse>('/v1/me/deletion/init', {
		method: 'POST',
		accountId
	});
}

export function confirmDeletion(req: DeletionConfirmRequest, accountId?: string) {
	return apiFetch<DeletionConfirmResponse>('/v1/me/deletion/confirm', {
		method: 'POST',
		body: req,
		accountId,
		skipRetryOnUnauthorized: true
	});
}

export function initDeletionOpaque(req: AccountDeletionOpaqueInitRequest, accountId?: string) {
	return apiFetch<AccountDeletionOpaqueInitResponse>('/v1/me/deletion/opaque/init', {
		method: 'POST',
		body: req,
		accountId
	});
}

export function confirmDeletionOpaque(req: AccountDeletionOpaqueConfirmRequest, accountId?: string) {
	return apiFetch<DeletionConfirmResponse>('/v1/me/deletion/opaque/confirm', {
		method: 'POST',
		body: req,
		accountId,
		skipRetryOnUnauthorized: true
	});
}

export function cancelDeletion(accountId?: string) {
	return apiFetch<void>('/v1/me/deletion', {
		method: 'DELETE',
		accountId
	});
}
