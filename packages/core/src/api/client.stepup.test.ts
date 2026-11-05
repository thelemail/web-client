import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/public', () => ({
	PUBLIC_API_BASE_URL: 'https://auth.test',
	PUBLIC_SUBMISSION_BASE_URL: 'https://submit.test'
}));
vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/realtime/device', () => ({ deviceId: () => 'device-1' }));

import {
	apiFetch,
	csrfStore,
	registerAuthRouter,
	registerReauthHandler,
	registerTransport
} from './client';
import { ApiCallError } from './types';

const ACCOUNT = 'acct-1';

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const grantRequired = () =>
	json(403, {
		error: { code: 'step_up_grant_required', message: 'this action needs a fresh confirmation' }
	});

async function digestOf(body: string): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
	return btoa(String.fromCharCode(...d));
}

interface Seen {
	url: string;
	headers: Record<string, string>;
	body: string | null;
}

let seen: Seen[] = [];

beforeEach(() => {
	seen = [];
	csrfStore.clear();
	registerAuthRouter({
		currentAccountId: () => ACCOUNT,
		getAccessToken: () => 'token',
		onUnauthorized: async () => false
	});
	registerReauthHandler(null);
});

function record(url: string, init?: RequestInit) {
	seen.push({
		url,
		headers: { ...(init?.headers as Record<string, string>) },
		body: typeof init?.body === 'string' ? init.body : null
	});
}

describe('apiFetch step-up grants', () => {
	it('mints a grant bound to the exact request and retries once with it', async () => {
		registerTransport(async (url, init) => {
			record(url, init);
			if (url.endsWith('/v1/auth/step-up/grants')) {
				return json(200, { grant: 'g-1', expiresInSeconds: 60 });
			}
			const h = init?.headers as Record<string, string>;
			return h['X-Step-Up-Grant'] === 'g-1' ? json(200, { ok: true }) : grantRequired();
		});

		const body = { name: 'Desk key' };
		await apiFetch('/v1/2fa/webauthn/credentials/c-1/rename', { method: 'POST', body });

		expect(seen.map((s) => s.url)).toEqual([
			'https://auth.test/v1/2fa/webauthn/credentials/c-1/rename',
			'https://auth.test/v1/auth/step-up/grants',
			'https://auth.test/v1/2fa/webauthn/credentials/c-1/rename'
		]);
		expect(JSON.parse(seen[1].body ?? '')).toEqual({
			method: 'POST',
			path: '/v1/2fa/webauthn/credentials/c-1/rename',
			bodyDigest: await digestOf(JSON.stringify(body))
		});
		expect(seen[2].body).toBe(seen[0].body);
	});

	it('digests an empty body as zero bytes and drops the query string', async () => {
		registerTransport(async (url, init) => {
			record(url, init);
			if (url.endsWith('/v1/auth/step-up/grants')) {
				return json(200, { grant: 'g-2', expiresInSeconds: 60 });
			}
			const h = init?.headers as Record<string, string>;
			return h['X-Step-Up-Grant'] ? new Response(null, { status: 204 }) : grantRequired();
		});

		await apiFetch('/v1/auth/sessions/s-1?reason=lost', { method: 'DELETE' });

		expect(JSON.parse(seen[1].body ?? '')).toEqual({
			method: 'DELETE',
			path: '/v1/auth/sessions/s-1',
			bodyDigest: await digestOf('')
		});
	});

	it('does not ask twice when the granted retry is refused again', async () => {
		registerTransport(async (url, init) => {
			record(url, init);
			if (url.endsWith('/v1/auth/step-up/grants')) {
				return json(200, { grant: 'g-3', expiresInSeconds: 60 });
			}
			return grantRequired();
		});

		const err = await apiFetch('/v1/auth/sessions/revoke-others', { method: 'POST' }).catch((e) => e);

		expect(err).toBeInstanceOf(ApiCallError);
		expect(seen.filter((s) => s.url.endsWith('/v1/auth/step-up/grants'))).toHaveLength(1);
	});
});

describe('apiFetch csrf tokens', () => {
	it('sends the remembered token only on calls that ask for it', async () => {
		registerTransport(async (url, init) => {
			record(url, init);
			return new Response(null, { status: 204 });
		});
		csrfStore.remember(ACCOUNT, 'csrf-1');

		await apiFetch('/v1/auth/logout', {
			method: 'POST',
			skipAuth: true,
			accountId: ACCOUNT,
			csrf: true
		});
		await apiFetch('/v1/auth/sessions', { method: 'GET', accountId: ACCOUNT });

		expect(seen[0].headers['X-CSRF-Token']).toBe('csrf-1');
		expect(seen[1].headers['X-CSRF-Token']).toBeUndefined();
	});

	it('sends nothing when no token was issued', async () => {
		registerTransport(async (url, init) => {
			record(url, init);
			return new Response(null, { status: 204 });
		});

		await apiFetch('/v1/auth/logout', {
			method: 'POST',
			skipAuth: true,
			accountId: ACCOUNT,
			csrf: true
		});

		expect(seen[0].headers['X-CSRF-Token']).toBeUndefined();
	});
});
