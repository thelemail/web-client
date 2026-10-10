import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_API_BASE_URL: 'https://api.test',
	PUBLIC_SUBMISSION_BASE_URL: 'https://submit.test'
}));
vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/realtime/device', () => ({ deviceId: () => 'device-1' }));

import { apiFetch, registerAuthRouter, registerTransport } from './client';
import { ApiCallError } from './types';

const ACCOUNT = 'acct-1';

let lost = false;
const transport = vi.fn(async () => new Response(null, { status: 204 }));
const ensureFreshToken = vi.fn(async () => {});
const onUnauthorized = vi.fn(async () => false);

beforeEach(() => {
	lost = false;
	transport.mockClear();
	ensureFreshToken.mockClear();
	onUnauthorized.mockClear();
	registerTransport(transport);
	registerAuthRouter({
		currentAccountId: () => ACCOUNT,
		getAccessToken: () => null,
		ensureFreshToken,
		isSessionLost: () => lost,
		onUnauthorized
	});
});

describe('apiFetch with a lost session', () => {
	it('fails locally without touching the network', async () => {
		lost = true;

		const err = await apiFetch('/v1/messages/counts').catch((e) => e);

		expect(err).toBeInstanceOf(ApiCallError);
		expect((err as ApiCallError).status).toBe(401);
		expect(transport).not.toHaveBeenCalled();
		expect(ensureFreshToken).not.toHaveBeenCalled();
		expect(onUnauthorized).not.toHaveBeenCalled();
	});

	it('still sends unauthenticated calls', async () => {
		lost = true;

		await apiFetch('/v1/auth/refresh', { method: 'POST', skipAuth: true });

		expect(transport).toHaveBeenCalledTimes(1);
	});

	it('sends normally while the session is live', async () => {
		await apiFetch('/v1/messages/counts');

		expect(ensureFreshToken).toHaveBeenCalledTimes(1);
		expect(transport).toHaveBeenCalledTimes(1);
	});
});
