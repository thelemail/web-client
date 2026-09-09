import { describe, it, expect, vi, beforeEach } from 'vitest';

const sessionForget = vi.fn();
const apiLogout = vi.fn();
const apiLogoutAll = vi.fn();
const keystoreClear = vi.fn();
const keystoreClearAll = vi.fn();
const accountsRemove = vi.fn();
const accountsClear = vi.fn();

let list: { accountId: string; slot: number; email: string; addedAt: number; lastActiveAt: number }[] = [];

vi.mock('$platform', () => ({
	platform: {
		billing: 'handoff',
		mirror: {},
		session: {
			persist: vi.fn(),
			restore: vi.fn(),
			forget: (...a: unknown[]) => sessionForget(...a)
		},
		transport: {},
		blobFetch: vi.fn(),
		blobPut: vi.fn(),
		returnOrigin: () => 'tauri://localhost',
		openExternal: vi.fn(),
		saveBlob: vi.fn()
	}
}));

vi.mock('$lib/api/auth', () => ({
	refreshSession: vi.fn(),
	logout: (...a: unknown[]) => apiLogout(...a),
	logoutAll: (...a: unknown[]) => apiLogoutAll(...a),
	getMe: vi.fn(),
	getPersistentHalf: vi.fn()
}));

vi.mock('$lib/keystore/keystore-client', () => ({
	keystore: {
		clear: (...a: unknown[]) => keystoreClear(...a),
		clearAll: (...a: unknown[]) => keystoreClearAll(...a),
		status: vi.fn(async () => ({ accounts: [] })),
		subscribe: vi.fn(() => () => {}),
		tryRestoreFromPersistent: vi.fn(),
		disablePersistent: vi.fn()
	}
}));

vi.mock('$lib/avatarCache.svelte', () => ({
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
		get list() {
			return list;
		},
		byId: (id: string) => list.find((r) => r.accountId === id) ?? null,
		remove: (...a: unknown[]) => accountsRemove(...a),
		clear: (...a: unknown[]) => accountsClear(...a),
		load: vi.fn(),
		touch: vi.fn(),
		upsert: vi.fn(),
		allocateSlot: () => 1
	}
}));

import { auth } from './auth.svelte';

function record(accountId: string, slot: number) {
	return { accountId, slot, email: `${accountId}@example.com`, addedAt: 1, lastActiveAt: 1 };
}

describe('removing accounts from a device', () => {
	beforeEach(() => {
		sessionForget.mockReset();
		apiLogout.mockReset();
		apiLogoutAll.mockReset();
		keystoreClear.mockReset();
		keystoreClearAll.mockReset();
		accountsRemove.mockReset();
		accountsClear.mockReset();
		list = [record('a', 1), record('b', 2)];
	});

	it('removes a locked account that is not the active one', async () => {
		auth.addSession('tok', 3600, 'a');
		auth.activate('a');

		await auth.logoutAccount('b');

		expect(apiLogout).toHaveBeenCalledWith('b');
		expect(keystoreClear).toHaveBeenCalledWith({ accountId: 'b' });
		expect(sessionForget).toHaveBeenCalledWith('b');
		expect(accountsRemove).toHaveBeenCalledWith('b');
		expect(auth.accountId).toBe('a');
	});

	it('still wipes the device when the server logout fails', async () => {
		apiLogout.mockRejectedValue(new Error('offline'));

		await auth.logoutAccount('b');

		expect(sessionForget).toHaveBeenCalledWith('b');
		expect(accountsRemove).toHaveBeenCalledWith('b');
	});

	it('forgets every account natively when signing out of all of them', async () => {
		await auth.logoutAll();

		expect(apiLogoutAll).toHaveBeenCalledTimes(1);
		expect(keystoreClearAll).toHaveBeenCalledTimes(1);
		expect(sessionForget.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b']);
		expect(accountsClear).toHaveBeenCalledTimes(1);
		expect(auth.accountId).toBeNull();
	});

	it('keeps going when one native forget fails', async () => {
		sessionForget.mockImplementation(async (id: string) => {
			if (id === 'a') throw new Error('keychain');
		});

		await auth.logoutAll();

		expect(sessionForget).toHaveBeenCalledTimes(2);
		expect(accountsClear).toHaveBeenCalledTimes(1);
	});
});
