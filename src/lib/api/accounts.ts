import { apiFetch } from './client';
import type { AccountLookupResponse } from './types';

export function lookupAccount(email: string): Promise<AccountLookupResponse> {
	const qs = new URLSearchParams({ email });
	return apiFetch<AccountLookupResponse>(`/v1/accounts/lookup?${qs.toString()}`);
}
