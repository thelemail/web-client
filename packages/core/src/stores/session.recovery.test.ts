import { describe, it, expect, vi, beforeEach } from 'vitest';

const refreshSession = vi.fn();
const slots = vi.hoisted(() => ({ host: new Set<string>(), upserts: [] as { accountId: string; sessionOrigin?: string }[] }));

vi.mock('$core/api/auth', () => ({
	refreshSession: (...a: unknown[]) => refreshSession(...a),
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

vi.mock('./accounts.svelte', () => ({
	accounts: {
		list: [],
		byId: (id: string) => ({ accountId: id, slot: 0, email: 'calloway@thelemail.test', addedAt: 1, lastActiveAt: 1, ...(slots.host.has(id) ? { sessionOrigin: 'host' } : {}) }),
		remove: vi.fn(),
		clear: vi.fn(),
		load: vi.fn(),
		touch: vi.fn(),
		upsert: vi.fn(async (rec: { accountId: string; sessionOrigin?: string }) => {
			slots.upserts.push(rec);
			if (rec.sessionOrigin === 'host') slots.host.add(rec.accountId);
		}),
		allocateSlot: () => 1
	}
}));

import { auth } from './auth.svelte';
import { ApiCallError } from '$core/api/types';

let seq = 0;
function freshId(): string {
	seq += 1;
	return `acc-recover-${seq}`;
}

function grant(accountId: string) {
	return { accessToken: `tok-${accountId}`, expiresInSeconds: 3600, accountId, csrfToken: 'csrf' };
}

const unauthorized = () => new ApiCallError(401, null, 'HTTP 401');

describe('session refresh across a custody change', () => {
	beforeEach(() => {
		refreshSession.mockReset();
		slots.host.clear();
		slots.upserts.length = 0;
		auth.registerSessionRecovery(null);
	});

	it('follows the session to the mail host instead of signing the account out', async () => {
		const id = freshId();
		refreshSession.mockImplementation(async (_id: string, base?: string) => {
			if (base === undefined) throw unauthorized();
			return grant(id);
		});
		const recover = vi.fn(async (accountId: string) => {
			slots.host.add(accountId);
			return true;
		});
		auth.registerSessionRecovery(recover);

		expect(await auth.tryRefresh(id)).toBe(true);
		expect(recover).toHaveBeenCalledWith(id, undefined);
		expect(refreshSession).toHaveBeenNthCalledWith(1, id, undefined);
		expect(refreshSession).toHaveBeenNthCalledWith(2, id, window.location.origin);
		expect(auth.sessionLost(id)).toBe(false);
		expect(auth.getAccessToken(id)).toBe(`tok-${id}`);
	});

	it('marks the session lost when there is nothing to recover', async () => {
		const id = freshId();
		refreshSession.mockRejectedValue(unauthorized());
		const recover = vi.fn(async () => false);
		auth.registerSessionRecovery(recover);

		expect(await auth.tryRefresh(id)).toBe(false);
		expect(recover).toHaveBeenCalledTimes(1);
		expect(refreshSession).toHaveBeenCalledTimes(1);
		expect(auth.sessionLost(id)).toBe(true);
	});

	it('marks the session lost when the recovered session is refused too', async () => {
		const id = freshId();
		refreshSession.mockRejectedValue(unauthorized());
		auth.registerSessionRecovery(async () => true);

		expect(await auth.tryRefresh(id)).toBe(false);
		expect(refreshSession).toHaveBeenCalledTimes(2);
		expect(auth.sessionLost(id)).toBe(true);
	});

	it('does not sign out on a failure that says nothing about the session', async () => {
		const id = freshId();
		refreshSession.mockRejectedValue(new TypeError('Failed to fetch'));
		const recover = vi.fn(async () => true);
		auth.registerSessionRecovery(recover);

		expect(await auth.tryRefresh(id)).toBe(false);
		expect(recover).not.toHaveBeenCalled();
		expect(auth.sessionLost(id)).toBe(false);
	});

	it('survives a recovery that throws', async () => {
		const id = freshId();
		refreshSession.mockRejectedValue(unauthorized());
		auth.registerSessionRecovery(async () => {
			throw new Error('idb unavailable');
		});
		expect(await auth.tryRefresh(id)).toBe(false);
		expect(auth.sessionLost(id)).toBe(true);
	});

	it('binds the slot to the mail host when it adopts the exchanged session', async () => {
		const id = freshId();
		await auth.adoptHostSession(id, 'child-token', 600, 'host-csrf');
		expect(slots.upserts).toEqual([expect.objectContaining({ accountId: id, sessionOrigin: 'host' })]);
		expect(auth.getAccessToken(id)).toBe('child-token');
		expect(auth.sessionLost(id)).toBe(false);
		await auth.adoptHostSession(id, 'child-token-2', 600);
		expect(slots.upserts).toHaveLength(1);
		expect(auth.getAccessToken(id)).toBe('child-token-2');
	});
});
