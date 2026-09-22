import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { KeystoreBroadcast } from '$core/keystore/protocol';

const ACCOUNT = '120792e5-d313-4c0e-aa94-4a4b00cab094';
const FRESH_TOKEN = 'fresh-login-token';

const bus = vi.hoisted(() => ({
	listeners: new Set<(b: KeystoreBroadcast) => void>(),
	unlockOk: true
}));

function emit(b: KeystoreBroadcast): void {
	for (const l of bus.listeners) l(b);
}

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn() }));

vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribe: (l: (b: KeystoreBroadcast) => void) => {
			bus.listeners.add(l);
			return () => bus.listeners.delete(l);
		},
		status: async () => ({ accounts: [] }),
		opaqueStartAuth: async () => ({ operationId: 'op-1', ke1: 'ke1' }),
		opaqueFinishAuth: async () => ({ ok: true, ke3: 'ke3' }),
		opaqueAbandonOperation: async () => undefined,
		opaqueCompleteLoginUnlock: async ({ accountId }: { accountId: string }) => {
			if (!bus.unlockOk) return { ok: false, code: 'invalid_credentials' };
			emit({ type: 'vaultChanged', accountId, email: 'r@thelemail.com' });
			await new Promise((resolve) => setTimeout(resolve, 0));
			return { ok: true };
		},
		loadAliasKeys: async () => ({ ok: true })
	}
}));

vi.mock('$core/api/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/api/auth')>()),
	loginInit: async () => ({ challengeId: 'ch-1', accountId: ACCOUNT, ke2: 'ke2' }),
	loginComplete: async () => ({
		accountId: ACCOUNT,
		accessToken: FRESH_TOKEN,
		tokenType: 'Bearer',
		expiresInSeconds: 3600,
		encryptedPrivateKey: 'epk',
		wrappedMasterKey: 'wmk',
		masterKeyId: 'mk-1',
		opaqueParamsVersion: 1
	})
}));

vi.mock('$core/stores/accounts.svelte', () => ({
	accounts: {
		list: [],
		lastActiveSlot: null,
		load: async () => undefined,
		byId: () => undefined,
		bySlot: () => undefined,
		allocateSlot: () => 0,
		upsert: async () => undefined,
		touch: async () => undefined,
		remove: async () => undefined
	}
}));

vi.mock('$core/keys/uid-sync', () => ({ syncAddressUids: async () => undefined }));

interface SentRequest {
	path: string;
	authorization: string | null;
	accountId: string | null;
}

const sent: SentRequest[] = [];

vi.stubGlobal(
	'fetch',
	vi.fn(async (url: string, init: RequestInit) => {
		const headers = (init.headers ?? {}) as Record<string, string>;
		const path = new URL(url).pathname;
		const authorization = headers['Authorization'] ?? null;
		sent.push({ path, authorization, accountId: headers['X-Account-Id'] ?? null });
		const json = (status: number, body: unknown) =>
			new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
		if (path === '/v1/auth/refresh') {
			return json(200, { accessToken: 'refreshed', expiresInSeconds: 3600, accountId: ACCOUNT });
		}
		if (authorization !== `Bearer ${FRESH_TOKEN}`) {
			return json(401, { error: { code: 'unauthorized', message: 'authentication required' } });
		}
		if (path === '/v1/me/alias-keys' || path === '/v1/me/calendar-keys') return json(200, { keys: [] });
		if (path === '/v1/me/signatures') return json(200, { signatures: [] });
		if (path === '/v1/me') return json(200, { accountId: ACCOUNT, email: 'r@thelemail.com', fullName: null });
		return json(200, {});
	})
);

const { auth } = await import('$core/stores/auth.svelte');
const { aliasKeys } = await import('$core/stores/aliasKeys.svelte');
const { calendarKeys } = await import('$core/stores/calendarKeys.svelte');
const { performLogin } = await import('./perform-login');

async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('performLogin after the account was cleared in this tab', () => {
	beforeEach(async () => {
		bus.unlockOk = true;
		auth.subscribeOnce();
		auth.setSession('pre-reset-token', 3600, ACCOUNT);
		aliasKeys.setAccount(ACCOUNT);
		calendarKeys.setAccount(ACCOUNT);
		emit({ type: 'cleared', accountId: ACCOUNT });
		await settle();
		sent.length = 0;
	});

	it('sends every key fetch with the fresh token and account, never relying on a 401 refresh', async () => {
		await performLogin({ email: 'r@thelemail.com', password: 'pw' });
		await Promise.all([aliasKeys.ready(ACCOUNT), calendarKeys.ready(ACCOUNT)]);
		await settle();

		const keyFetches = sent.filter((r) => r.path.startsWith('/v1/me'));
		expect(keyFetches.length).toBeGreaterThan(0);
		for (const r of keyFetches) {
			expect(r, r.path).toMatchObject({ authorization: `Bearer ${FRESH_TOKEN}`, accountId: ACCOUNT });
		}
		expect(sent.some((r) => r.path === '/v1/auth/refresh')).toBe(false);
	});

	it('leaves no session behind when the vault refuses to unlock', async () => {
		bus.unlockOk = false;
		await expect(performLogin({ email: 'r@thelemail.com', password: 'pw' })).rejects.toThrow();
		expect(auth.getAccessToken(ACCOUNT)).toBeNull();
	});
});
