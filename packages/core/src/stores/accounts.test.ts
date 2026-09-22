import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AccountSlotRecord } from '$core/keystore/idb';

let stored: AccountSlotRecord[] = [];
const putAccountSlot = vi.fn(async (rec: AccountSlotRecord) => {
	stored = stored.map((r) => (r.accountId === rec.accountId ? rec : r));
});

vi.mock('$core/keystore/idb', () => ({
	getAllAccountSlots: vi.fn(async () => stored.map((r) => ({ ...r }))),
	putAccountSlot: (rec: AccountSlotRecord) => putAccountSlot(rec),
	deleteAccountSlot: vi.fn(),
	clearAllAccountSlots: vi.fn()
}));

vi.mock('./session-hint', () => ({ syncSessionHint: vi.fn() }));

import { accounts } from './accounts.svelte';

describe('saved account emails', () => {
	beforeEach(() => {
		putAccountSlot.mockClear();
		stored = [
			{ accountId: 'a', slot: 0, email: 'ana@acme.test', addedAt: 1, lastActiveAt: 5 },
			{ accountId: 'b', slot: 1, email: 'bo@acme.test', addedAt: 2, lastActiveAt: 6 }
		];
	});

	it('rewrites the email of the matching account in place', async () => {
		await accounts.setEmail('a', 'ana@thelemail.com');

		expect(stored).toEqual([
			{ accountId: 'a', slot: 0, email: 'ana@thelemail.com', addedAt: 1, lastActiveAt: 5 },
			{ accountId: 'b', slot: 1, email: 'bo@acme.test', addedAt: 2, lastActiveAt: 6 }
		]);
		expect(accounts.byId('a')?.email).toBe('ana@thelemail.com');
		expect(accounts.bySlot(0)?.accountId).toBe('a');
	});

	it('skips the write when nothing changed or the account is unknown', async () => {
		await accounts.setEmail('a', 'ana@acme.test');
		await accounts.setEmail('zz', 'zz@acme.test');

		expect(putAccountSlot).not.toHaveBeenCalled();
	});
});
