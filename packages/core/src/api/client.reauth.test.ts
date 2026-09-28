import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/static/public', () => ({
	PUBLIC_API_BASE_URL: 'https://api.test',
	PUBLIC_SUBMISSION_BASE_URL: 'https://submit.test'
}));
vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/realtime/device', () => ({ deviceId: () => 'device-1' }));

import { apiFetch, registerAuthRouter, registerReauthHandler, registerTransport } from './client';
import { ApiCallError } from './types';

const ACCOUNT = 'acct-1';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const reauthRequired = () =>
	json(403, { error: { code: 'reauthentication_required', message: 'recent authentication required' } });

let token = 'old-token';
let seen: string[] = [];

beforeEach(() => {
	token = 'old-token';
	seen = [];
	registerAuthRouter({
		currentAccountId: () => ACCOUNT,
		getAccessToken: () => token,
		onUnauthorized: async () => false
	});
	registerReauthHandler(null);
});

describe('apiFetch reauthentication', () => {
	it('retries once with the stepped-up token', async () => {
		registerTransport(async (_url, init) => {
			const auth = (init?.headers as Record<string, string>).Authorization;
			seen.push(auth);
			return auth === 'Bearer new-token' ? new Response(null, { status: 204 }) : reauthRequired();
		});
		const handler = vi.fn(async (accountId: string) => {
			expect(accountId).toBe(ACCOUNT);
			token = 'new-token';
			return true;
		});
		registerReauthHandler(handler);

		await apiFetch('/v1/auth/sessions/revoke-others', { method: 'POST' });

		expect(handler).toHaveBeenCalledTimes(1);
		expect(seen).toEqual(['Bearer old-token', 'Bearer new-token']);
	});

	it('surfaces the original error when the step-up is cancelled', async () => {
		registerTransport(async () => reauthRequired());
		registerReauthHandler(async () => false);

		const err = await apiFetch('/v1/billing/cancel', { method: 'POST' }).catch((e) => e);
		expect(err).toBeInstanceOf(ApiCallError);
		expect((err as ApiCallError).status).toBe(403);
	});

	it('asks only once even if the retry is refused again', async () => {
		registerTransport(async () => reauthRequired());
		const handler = vi.fn(async () => true);
		registerReauthHandler(handler);

		await expect(apiFetch('/v1/2fa/totp/disable', { method: 'POST' })).rejects.toBeInstanceOf(ApiCallError);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('never prompts for requests that opt out', async () => {
		registerTransport(async () => reauthRequired());
		const handler = vi.fn(async () => true);
		registerReauthHandler(handler);

		await expect(
			apiFetch('/v1/auth/step-up/opaque/confirm', { method: 'POST', skipReauth: true })
		).rejects.toBeInstanceOf(ApiCallError);
		expect(handler).not.toHaveBeenCalled();
	});

	it('ignores other forbidden responses', async () => {
		registerTransport(async () => json(403, { error: { code: 'forbidden', message: 'no' } }));
		const handler = vi.fn(async () => true);
		registerReauthHandler(handler);

		await expect(apiFetch('/v1/workspaces/w/members/m', { method: 'DELETE' })).rejects.toBeInstanceOf(
			ApiCallError
		);
		expect(handler).not.toHaveBeenCalled();
	});
});
