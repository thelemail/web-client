import { apiFetch } from '$core/api/client';
import { hostFetch } from '$core/producthandoff/api';

export interface PreparedExchange {
	migrationId: string;
	ticket: string;
	expiresAt: string;
}

export interface InstalledExchange {
	migrationId: string;
	accountId: string;
	sessionId: string;
	accessToken: string;
	expiresIn: number;
	serverHalf?: string;
	committed: boolean;
	csrfToken?: string;
}

export interface CommittedExchange {
	accountId: string;
	sessionId: string;
	cookieInstalled: boolean;
	csrfToken?: string;
}

export interface ExchangeStatus {
	migrationId: string;
	status: 'prepared' | 'installed' | 'committed' | 'expired' | 'cancelled';
	sessionId: string;
	active: boolean;
	expiresAt: string;
}

export function prepareExchange(accountId: string, body: { operationId: string; codeChallenge: string; targetDigest: string }): Promise<PreparedExchange> {
	return apiFetch('/v1/auth/session-migrations/prepare', { method: 'POST', body, accountId });
}

export function installExchange(migrationId: string, csrf: string, body: { ticket: string; verifier: string }): Promise<InstalledExchange> {
	return hostFetch(`/v1/auth/session-migrations/${migrationId}/install`, { method: 'POST', body, csrf });
}

export function commitExchange(migrationId: string, token: string, body: { targetDigest: string }): Promise<CommittedExchange> {
	return hostFetch(`/v1/auth/session-migrations/${migrationId}/commit`, { method: 'POST', body, token });
}

export function exchangeStatus(migrationId: string, token: string): Promise<ExchangeStatus> {
	return hostFetch(`/v1/auth/session-migrations/${migrationId}/status`, { token });
}
