import { describe, it, expect, vi, beforeEach } from 'vitest';

const getPersistentHalf = vi.fn();
const status = vi.fn();
const tryRestoreFromPersistent = vi.fn();
const disablePersistent = vi.fn();
const product = vi.hoisted(() => ({ isAuthOrigin: false }));

vi.mock('$core/products', () => ({
	currentProduct: 'app',
	get isAuthOrigin() {
		return product.isAuthOrigin;
	}
}));

vi.mock('$core/api/auth', () => ({
	refreshSession: vi.fn(),
	logout: vi.fn(),
	logoutAll: vi.fn(),
	getMe: vi.fn(),
	getPersistentHalf: (...a: unknown[]) => getPersistentHalf(...a)
}));

vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		clear: vi.fn(),
		clearAll: vi.fn(),
		status: (...a: unknown[]) => status(...a),
		subscribe: vi.fn(() => () => {}),
		tryRestoreFromPersistent: (...a: unknown[]) => tryRestoreFromPersistent(...a),
		disablePersistent: (...a: unknown[]) => disablePersistent(...a)
	}
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
import { ApiCallError } from '$core/api/types';

const ACCOUNT = 'acc-restore';

function remembered() {
	status.mockResolvedValue({
		accounts: [{ accountId: ACCOUNT, email: 'calloway@thelemail.test', unlocked: false, hasPersistent: true, authScheme: 'opaque_v1' }]
	});
}

describe('remembered vault restore', () => {
	beforeEach(() => {
		getPersistentHalf.mockReset();
		status.mockReset();
		tryRestoreFromPersistent.mockReset();
		disablePersistent.mockReset();
		product.isAuthOrigin = false;
		remembered();
	});

	it('keeps the stored vault when the product restore does not unwrap', async () => {
		getPersistentHalf.mockResolvedValue({ serverHalf: 'aGFsZg==' });
		tryRestoreFromPersistent.mockResolvedValue({ ok: false, reason: 'unwrap_failed' });

		expect(await auth.ensureVaultUnlocked(ACCOUNT)).toBe(false);
		expect(tryRestoreFromPersistent).toHaveBeenCalledWith({ accountId: ACCOUNT, serverHalf: 'aGFsZg==' });
		expect(disablePersistent).not.toHaveBeenCalled();
	});

	it('keeps the stored vault when the product half is refused', async () => {
		getPersistentHalf.mockRejectedValue(new ApiCallError(401, null, 'authentication required'));

		expect(await auth.ensureVaultUnlocked(ACCOUNT)).toBe(false);
		expect(tryRestoreFromPersistent).not.toHaveBeenCalled();
		expect(disablePersistent).not.toHaveBeenCalled();
	});

	it('keeps the stored vault when the half request fails in transit', async () => {
		getPersistentHalf.mockRejectedValue(new TypeError('Failed to fetch'));

		expect(await auth.ensureVaultUnlocked(ACCOUNT)).toBe(false);
		expect(disablePersistent).not.toHaveBeenCalled();
	});

	it('still drops an unusable remembered vault on the auth origin', async () => {
		product.isAuthOrigin = true;
		getPersistentHalf.mockResolvedValue({ serverHalf: 'aGFsZg==' });
		tryRestoreFromPersistent.mockResolvedValue({ ok: false, reason: 'unwrap_failed' });

		expect(await auth.ensureVaultUnlocked(ACCOUNT)).toBe(false);
		expect(disablePersistent).toHaveBeenCalledWith({ accountId: ACCOUNT });
	});

	it('opens the vault when the restore succeeds', async () => {
		getPersistentHalf.mockResolvedValue({ serverHalf: 'aGFsZg==' });
		tryRestoreFromPersistent.mockResolvedValue({ ok: true, accountId: ACCOUNT, email: 'calloway@thelemail.test' });

		expect(await auth.ensureVaultUnlocked(ACCOUNT)).toBe(true);
		expect(disablePersistent).not.toHaveBeenCalled();
	});
});
