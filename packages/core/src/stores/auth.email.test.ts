import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AccountAddress } from '$core/api/addresses';
import type { MeResponse } from '$core/api/types';

const getMe = vi.fn();
const listMyAddresses = vi.fn();
const setPrimaryAddress = vi.fn();
const accountsSetEmail = vi.fn();

let slots: { accountId: string; slot: number; email: string; addedAt: number; lastActiveAt: number }[] = [];

vi.mock('$core/api/auth', () => ({
	refreshSession: vi.fn(),
	logout: vi.fn(),
	logoutAll: vi.fn(),
	getMe: (...a: unknown[]) => getMe(...a),
	getPersistentHalf: vi.fn()
}));

vi.mock('$core/api/addresses', () => ({
	listMyAddresses: (...a: unknown[]) => listMyAddresses(...a),
	updateMyAddress: vi.fn(),
	setPrimaryAddress: (...a: unknown[]) => setPrimaryAddress(...a),
	removeAddress: vi.fn()
}));

vi.mock('$core/api/aliases', () => ({
	listMySharedAliases: vi.fn(async () => ({ sharedAliases: [] }))
}));

vi.mock('$core/keys/uid-sync', () => ({ syncAddressUids: vi.fn() }));

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
		get list() {
			return slots;
		},
		byId: (id: string) => slots.find((r) => r.accountId === id) ?? null,
		setEmail: (...a: unknown[]) => accountsSetEmail(...a),
		remove: vi.fn(),
		clear: vi.fn(),
		load: vi.fn(),
		touch: vi.fn(),
		upsert: vi.fn(),
		allocateSlot: () => 1
	}
}));

import { auth } from './auth.svelte';
import { addresses } from './addresses.svelte';

function me(accountId: string, email: string): MeResponse {
	return { accountId, email, fullName: 'Ana', status: 'active', createdAt: '2026-09-01T00:00:00Z' };
}

function address(id: string, email: string, isPrimary: boolean): AccountAddress {
	return {
		id,
		accountId: 'acc-a',
		email,
		localPart: email.split('@')[0],
		isPrimary,
		createdAt: '2026-09-01T00:00:00Z',
		updatedAt: '2026-09-01T00:00:00Z'
	};
}

async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('account email after a primary address change', () => {
	beforeEach(() => {
		getMe.mockReset();
		listMyAddresses.mockReset();
		setPrimaryAddress.mockReset();
		accountsSetEmail.mockReset();
		slots = [{ accountId: 'acc-a', slot: 0, email: 'ana@acme.test', addedAt: 1, lastActiveAt: 1 }];
		auth.addSession('tok', 3600, 'acc-a');
		auth.activate('acc-a');
		auth.applyMe(me('acc-a', 'ana@acme.test'));
		accountsSetEmail.mockReset();
	});

	it('reloads the profile when the reloaded address list names a new primary', async () => {
		listMyAddresses.mockResolvedValue({
			addresses: [address('old', 'ana@acme.test', false), address('new', 'ana@thelemail.com', true)]
		});
		getMe.mockResolvedValue(me('acc-a', 'ana@thelemail.com'));

		await addresses.load();
		await settle();

		expect(getMe).toHaveBeenCalledWith('acc-a');
		expect(auth.email).toBe('ana@thelemail.com');
		expect(accountsSetEmail).toHaveBeenCalledWith('acc-a', 'ana@thelemail.com');
	});

	it('leaves the profile alone when the primary still matches', async () => {
		listMyAddresses.mockResolvedValue({ addresses: [address('old', 'Ana@acme.test', true)] });

		await addresses.load();
		await settle();

		expect(getMe).not.toHaveBeenCalled();
		expect(accountsSetEmail).not.toHaveBeenCalled();
	});

	it('reloads the profile after the user sets a new primary', async () => {
		addresses.items = [address('old', 'ana@acme.test', true), address('new', 'ana@home.test', false)];
		setPrimaryAddress.mockResolvedValue(address('new', 'ana@home.test', true));
		getMe.mockResolvedValue(me('acc-a', 'ana@home.test'));

		await addresses.setPrimary('new');
		await settle();

		expect(auth.email).toBe('ana@home.test');
		expect(accountsSetEmail).toHaveBeenCalledWith('acc-a', 'ana@home.test');
	});

	it('keeps the server email when the keystore reports its older copy', () => {
		auth.applyMe(me('acc-a', 'ana@thelemail.com'));

		auth.syncFromKeystoreStatus({
			accounts: [
				{
					accountId: 'acc-a',
					email: 'ana@acme.test',
					unlocked: true,
					hasPersistent: false,
					authScheme: 'opaque_v1'
				}
			]
		});

		expect(auth.email).toBe('ana@thelemail.com');
	});
});
