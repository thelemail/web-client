import { apiFetch } from './client';
import type { ExternalKeyTrust } from './types';

export function lookupExternalKey(email: string): Promise<ExternalKeyTrust> {
	return apiFetch('/v1/external-keys/lookup', { method: 'POST', body: { email } });
}

export function acceptExternalKey(address: string, keyFingerprint: string): Promise<ExternalKeyTrust> {
	return apiFetch('/v1/external-keys/accept', {
		method: 'POST',
		body: { address, keyFingerprint }
	});
}
