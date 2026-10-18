import { apiFetch } from './client';
import type { AccountLookupResponse, ResolveAvatarsResponse } from './types';

export function lookupAccount(
	email: string,
	tlogSince?: number,
	previousKeyFingerprint?: string
): Promise<AccountLookupResponse> {
	const body: { email: string; tlogSince?: number; previousKeyFingerprint?: string } = { email };
	if (tlogSince !== undefined && tlogSince > 0) body.tlogSince = tlogSince;
	if (previousKeyFingerprint) body.previousKeyFingerprint = previousKeyFingerprint.toLowerCase();
	return apiFetch<AccountLookupResponse>('/v1/accounts/lookup', { method: 'POST', body });
}

export function resolveAvatars(addresses: string[]): Promise<ResolveAvatarsResponse> {
	return apiFetch<ResolveAvatarsResponse>('/v1/accounts/avatars', {
		method: 'POST',
		body: { addresses }
	});
}
