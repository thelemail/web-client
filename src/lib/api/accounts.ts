import { apiFetch } from './client';
import type { AccountLookupResponse, ResolveAvatarsResponse } from './types';

export function lookupAccount(email: string): Promise<AccountLookupResponse> {
	const qs = new URLSearchParams({ email });
	return apiFetch<AccountLookupResponse>(`/v1/accounts/lookup?${qs.toString()}`);
}

export function resolveAvatars(addresses: string[]): Promise<ResolveAvatarsResponse> {
	return apiFetch<ResolveAvatarsResponse>('/v1/accounts/avatars', {
		method: 'POST',
		body: { addresses }
	});
}
