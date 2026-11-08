import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
	isAuthenticated: false,
	vaultUnlocked: false,
	activate: vi.fn(),
	tryRefresh: vi.fn(async () => true),
	ensureVaultUnlocked: vi.fn(async () => true),
	loadProfile: vi.fn(async () => true)
}));
const accounts = vi.hoisted(() => ({
	bySlot: vi.fn((slot: number) => (slot === 1 ? { accountId: 'acct-1', slot: 1 } : undefined))
}));

vi.mock('$core/stores/session.svelte', () => ({ auth: session }));
const productKeys = vi.hoisted(() => ({ ensureProductKeys: vi.fn(async () => ({ status: 'disabled' })) }));

vi.mock('$core/stores/accounts.svelte', () => ({ accounts }));
vi.mock('$core/auth/product-keys', () => productKeys);

import { load } from './+layout';

type LoadEvent = Parameters<typeof load>[0];

function event(slot: string): LoadEvent {
	return { parent: async () => ({}), params: { slot } } as unknown as LoadEvent;
}

async function redirectOf(slot: string): Promise<string | null> {
	try {
		await load(event(slot));
		return null;
	} catch (err) {
		return (err as { location?: string }).location ?? null;
	}
}

beforeEach(() => {
	session.isAuthenticated = false;
	session.vaultUnlocked = false;
	session.tryRefresh.mockResolvedValue(true);
	session.ensureVaultUnlocked.mockResolvedValue(true);
	vi.clearAllMocks();
});

describe('account guard', () => {
	it('sends an unknown slot to sign-in', async () => {
		expect(await redirectOf('7')).toBe('/login');
	});

	it('asks for the password again when the session cannot refresh', async () => {
		session.tryRefresh.mockResolvedValue(false);
		expect(await redirectOf('1')).toBe('/login?slot=1');
		expect(session.ensureVaultUnlocked).not.toHaveBeenCalled();
	});

	it('treats an evicted or locked vault as unlock again', async () => {
		session.ensureVaultUnlocked.mockResolvedValue(false);
		expect(await redirectOf('1')).toBe('/login?slot=1');
		expect(productKeys.ensureProductKeys).not.toHaveBeenCalled();
	});

	it('prepares product keys once the vault is open, without waiting for it', async () => {
		let release: () => void = () => {};
		productKeys.ensureProductKeys.mockImplementation(() => new Promise((resolve) => (release = () => resolve({ status: 'disabled' }))));
		await expect(load(event('1'))).resolves.toEqual({ accountId: 'acct-1', slot: 1 });
		expect(productKeys.ensureProductKeys).toHaveBeenCalledWith('acct-1');
		release();
	});

	it('refreshes before it restores, so the restore carries the csrf token', async () => {
		const order: string[] = [];
		session.tryRefresh.mockImplementation(async () => {
			order.push('refresh');
			return true;
		});
		session.ensureVaultUnlocked.mockImplementation(async () => {
			order.push('restore');
			return true;
		});
		await expect(load(event('1'))).resolves.toEqual({ accountId: 'acct-1', slot: 1 });
		expect(order).toEqual(['refresh', 'restore']);
		expect(session.activate).toHaveBeenCalledWith('acct-1');
	});
});
