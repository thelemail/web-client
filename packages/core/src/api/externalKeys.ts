import { apiFetch } from './client';
import type { ExternalKeyTrust } from './types';

export function lookupExternalKey(email: string): Promise<ExternalKeyTrust> {
	return apiFetch(`/v1/external-keys/lookup?email=${encodeURIComponent(email)}`);
}

export function acceptExternalKey(address: string, keyFingerprint: string): Promise<ExternalKeyTrust> {
	return apiFetch(`/v1/external-keys/${encodeURIComponent(address)}/accept`, {
		method: 'POST',
		body: { keyFingerprint }
	});
}
