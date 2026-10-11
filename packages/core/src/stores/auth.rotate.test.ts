import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionPersist = vi.fn();
const mirrorSetToken = vi.fn();

vi.mock('$platform', () => ({
	platform: {
		billing: 'handoff',
		mirror: {
			setToken: (...a: unknown[]) => mirrorSetToken(...a)
		},
		session: {
			persist: (...a: unknown[]) => sessionPersist(...a),
			restore: vi.fn(),
			forget: vi.fn()
		},
		transport: {},
		blobFetch: vi.fn(),
		blobPut: vi.fn(),
		returnOrigin: () => 'tauri://localhost',
		openExternal: vi.fn(),
		saveBlob: vi.fn()
	}
}));

vi.mock('$core/api/auth', () => ({
	refreshSession: vi.fn(),
	logout: vi.fn(),
	logoutAll: vi.fn(),
	getMe: vi.fn(),
	getPersistentHalf: vi.fn()
}));

vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		clear: vi.fn(),
		clearAll: vi.fn(),
		status: vi.fn(async () => ({ accounts: [] })),
		subscribe: vi.fn(() => () => {}),
		tryRestoreFromPersistent: vi.fn(),
		disablePersistent: vi.fn()
	}
}));

vi.mock('$core/avatarCache.svelte', () => ({
	cachedAvatarUrl: () => null,
	cacheAccountAvatar: vi.fn(),
	forgetAccountAvatar: vi.fn(),
	forgetAllAvatars: vi.fn(),
	hydrateAvatarCache: vi.fn(),
	hydratePersonAvatars: vi.fn(async () => new Map()),
	cachePersonAvatar: vi.fn(async () => null),
	releasePersonAvatars: vi.fn()
}));

vi.mock('./accounts.svelte', () => ({
	accounts: {
		list: [],
		byId: () => null,
		remove: vi.fn(),
		clear: vi.fn(),
		load: vi.fn(),
		touch: vi.fn(),
		upsert: vi.fn(),
		allocateSlot: () => 1
	}
}));

import { auth } from './auth.svelte';

function status(accountId: string, hasPersistent: boolean) {
	return {
		accounts: [
			{ accountId, email: `${accountId}@example.com`, unlocked: true, hasPersistent, authScheme: 'opaque_v1' as const }
		]
	};
}

describe('auth.adoptRotatedSession', () => {
	beforeEach(() => {
		sessionPersist.mockReset();
		mirrorSetToken.mockReset();
		mirrorSetToken.mockResolvedValue(undefined);
	});

	it('replaces the access token and hands it to the mirror', async () => {
		auth.setSession('old-token', 3600, 'acc-rotate');
		const before = auth.sessionRotations;

		await auth.adoptRotatedSession({
			accessToken: 'new-token',
			tokenType: 'Bearer',
			expiresInSeconds: 3600,
			accountId: 'acc-rotate'
		});

		expect(auth.getAccessToken('acc-rotate')).toBe('new-token');
		expect(mirrorSetToken).toHaveBeenCalledWith('acc-rotate', 'new-token');
		expect(auth.sessionRotations).toBe(before + 1);
	});

	it('re-persists the native session only for remembered accounts', async () => {
		auth.syncFromKeystoreStatus(status('acc-remembered', true));
		auth.syncFromKeystoreStatus(status('acc-transient', false));

		await auth.adoptRotatedSession({
			accessToken: 'a',
			tokenType: 'Bearer',
			expiresInSeconds: 3600,
			accountId: 'acc-remembered'
		});
		await auth.adoptRotatedSession({
			accessToken: 'b',
			tokenType: 'Bearer',
			expiresInSeconds: 3600,
			accountId: 'acc-transient'
		});

		expect(sessionPersist).toHaveBeenCalledTimes(1);
		expect(sessionPersist).toHaveBeenCalledWith('acc-remembered');
	});

	it('keeps the new token when the mirror is not open', async () => {
		mirrorSetToken.mockRejectedValue(new Error('mirror closed'));

		await auth.adoptRotatedSession({
			accessToken: 'still-new',
			tokenType: 'Bearer',
			expiresInSeconds: 3600,
			accountId: 'acc-no-mirror'
		});

		expect(auth.getAccessToken('acc-no-mirror')).toBe('still-new');
	});
});
