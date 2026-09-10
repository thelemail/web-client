import { apiFetch } from './client';

export interface ProduceForkResponse {
	selector: string;
	expiresInSeconds: number;
}

export interface ConsumeForkResponse {
	accountId: string;
	audience: string;
	payload: string;
}

export function produceSessionFork(
	accountId: string,
	audience: string,
	payload: string
): Promise<ProduceForkResponse> {
	return apiFetch('/v1/auth/sessions/forks', {
		method: 'POST',
		accountId,
		body: { audience, payload }
	});
}

export function consumeSessionFork(selector: string): Promise<ConsumeForkResponse> {
	return apiFetch(`/v1/auth/sessions/forks/${encodeURIComponent(selector)}`, {
		method: 'GET',
		skipAuth: true,
		skipRetryOnUnauthorized: true
	});
}
