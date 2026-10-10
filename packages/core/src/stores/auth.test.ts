import { describe, it, expect, vi, beforeEach } from 'vitest';

const refreshSession = vi.fn();
const keystoreClear = vi.fn();

vi.mock('$core/api/auth', () => ({
	refreshSession: (...a: unknown[]) => refreshSession(...a),
	logout: vi.fn(),
	logoutAll: vi.fn(),
	getMe: vi.fn(),
	getPersistentHalf: vi.fn()
}));

vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		clear: (...a: unknown[]) => keystoreClear(...a),
		clearAll: vi.fn(),
		status: vi.fn(async () => ({ accounts: [] })),
		subscribe: vi.fn(() => () => {}),
		tryRestoreFromPersistent: vi.fn(),
		disablePersistent: vi.fn()
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

function grant(accountId: string, expiresInSeconds = 3600) {
	return { accessToken: `tok-${accountId}-${Math.random()}`, expiresInSeconds, accountId };
}

let seq = 0;
function freshId(): string {
	seq += 1;
	return `acc-${seq}`;
}

describe('auth token refresh', () => {
	beforeEach(() => {
		refreshSession.mockReset();
		keystoreClear.mockReset();
	});

	it('single-flights concurrent tryRefresh for the same account', async () => {
		const id = freshId();
		let resolveIt: (v: unknown) => void = () => {};
		refreshSession.mockImplementation(
			() => new Promise((res) => (resolveIt = res))
		);

		const calls = [auth.tryRefresh(id), auth.tryRefresh(id), auth.tryRefresh(id)];
		resolveIt(grant(id));
		const results = await Promise.all(calls);

		expect(results).toEqual([true, true, true]);
		expect(refreshSession).toHaveBeenCalledTimes(1);
	});

	it('allows a new refresh after the in-flight one settles', async () => {
		const id = freshId();
		refreshSession.mockResolvedValue(grant(id));

		expect(await auth.tryRefresh(id)).toBe(true);
		expect(await auth.tryRefresh(id)).toBe(true);
		expect(refreshSession).toHaveBeenCalledTimes(2);
	});

	it('ensureFreshToken refreshes an expired token', async () => {
		const id = freshId();
		refreshSession.mockResolvedValue(grant(id));
		auth.addSession('stale', -10, id);

		await auth.ensureFreshToken(id);
		expect(refreshSession).toHaveBeenCalledTimes(1);
	});

	it('ensureFreshToken is a no-op for a comfortably fresh token', async () => {
		const id = freshId();
		auth.addSession('good', 3600, id);

		await auth.ensureFreshToken(id);
		expect(refreshSession).not.toHaveBeenCalled();
	});

	it('a failed refresh does not clear the vault', async () => {
		const id = freshId();
		refreshSession.mockRejectedValue(new Error('network'));

		expect(await auth.tryRefresh(id)).toBe(false);
		expect(keystoreClear).not.toHaveBeenCalled();
	});

	it('a 401 refresh marks the session lost and stops further refreshes', async () => {
		const id = freshId();
		auth.addSession('stale', -10, id);
		refreshSession.mockRejectedValue(new ApiCallError(401, null, 'HTTP 401'));

		expect(await auth.tryRefresh(id)).toBe(false);
		expect(auth.sessionLost(id)).toBe(true);
		expect(auth.getAccessToken(id)).toBeNull();

		await auth.ensureFreshToken(id);
		expect(await auth.tryRefresh(id)).toBe(false);
		expect(refreshSession).toHaveBeenCalledTimes(1);
		expect(keystoreClear).not.toHaveBeenCalled();
	});

	it('a 500 refresh stays retryable', async () => {
		const id = freshId();
		refreshSession.mockRejectedValue(new ApiCallError(500, null, 'HTTP 500'));

		expect(await auth.tryRefresh(id)).toBe(false);
		expect(auth.sessionLost(id)).toBe(false);
		expect(await auth.tryRefresh(id)).toBe(false);
		expect(refreshSession).toHaveBeenCalledTimes(2);
	});

	it('a new session clears the lost mark', async () => {
		const id = freshId();
		refreshSession.mockRejectedValueOnce(new ApiCallError(401, null, 'HTTP 401'));
		await auth.tryRefresh(id);
		expect(auth.sessionLost(id)).toBe(true);

		auth.addSession('fresh', 3600, id);
		expect(auth.sessionLost(id)).toBe(false);
		refreshSession.mockResolvedValue(grant(id));
		expect(await auth.tryRefresh(id)).toBe(true);
	});

	it('activating the account allows one more refresh attempt', async () => {
		const id = freshId();
		refreshSession.mockRejectedValue(new ApiCallError(401, null, 'HTTP 401'));
		await auth.tryRefresh(id);

		auth.activate(id);
		expect(auth.sessionLost(id)).toBe(false);
		expect(await auth.tryRefresh(id)).toBe(false);
		expect(refreshSession).toHaveBeenCalledTimes(2);
		expect(auth.sessionLost(id)).toBe(true);
	});
});
