import { apiFetch } from './client';
import type { AccountLookupResponse, ResolveAvatarsResponse } from './types';

export function lookupAccount(email: string, tlogSince?: number): Promise<AccountLookupResponse> {
	return apiFetch<AccountLookupResponse>('/v1/accounts/lookup', {
		method: 'POST',
		body: tlogSince !== undefined && tlogSince > 0 ? { email, tlogSince } : { email }
	});
}

export function resolveAvatars(addresses: string[]): Promise<ResolveAvatarsResponse> {
	return apiFetch<ResolveAvatarsResponse>('/v1/accounts/avatars', {
		method: 'POST',
		body: { addresses }
	});
}
