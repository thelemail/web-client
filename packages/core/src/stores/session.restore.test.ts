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

const slots = vi.hoisted(() => ({ records: new Map<string, { accountId: string; sessionId?: string }>(), setSessionId: vi.fn(async () => undefined) }));

vi.mock('./accounts.svelte', () => ({
	accounts: {
		list: [],
		byId: (id: string) => slots.records.get(id) ?? null,
		setSessionId: slots.setSessionId,
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

describe('the mail session an account holds', () => {
	const SID = '0b8f9a52-3c1d-4e6f-8a7b-9c0d1e2f3a4b';
	const token = (claims: object) => ['e30', btoa(JSON.stringify(claims)).replace(/=+$/, ''), 'sig'].join('.');

	beforeEach(() => {
		slots.records.clear();
		slots.setSessionId.mockClear();
	});

	it('remembers the session id of a new token on the account record', () => {
		slots.records.set('acc-sid', { accountId: 'acc-sid' });
		auth.addSession(token({ sid: SID, aud: 'app' }), 300, 'acc-sid');
		expect(auth.sessionIdFor('acc-sid')).toBe(SID);
		expect(slots.setSessionId).toHaveBeenCalledWith('acc-sid', SID);
	});

	it('falls back to the remembered id after a reload and ignores a malformed one', () => {
		slots.records.set('acc-reloaded', { accountId: 'acc-reloaded', sessionId: SID });
		expect(auth.sessionIdFor('acc-reloaded')).toBe(SID);
		slots.records.set('acc-odd', { accountId: 'acc-odd' });
		auth.addSession(token({ sid: 'not-a-session' }), 300, 'acc-odd');
		auth.addSession(token({}), 300, 'acc-odd');
		expect(auth.sessionIdFor('acc-odd')).toBeNull();
		expect(slots.setSessionId).not.toHaveBeenCalled();
	});
});
