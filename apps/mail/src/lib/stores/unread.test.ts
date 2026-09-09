import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMailboxCounts = vi.fn();
vi.mock('$lib/api/messages', () => ({
	getMailboxCounts: (...a: unknown[]) => getMailboxCounts(...a)
}));

import { unread } from './unread.svelte';

describe('unread store', () => {
	beforeEach(() => {
		getMailboxCounts.mockReset();
		unread.clear();
	});

	it('has no counts for an account until set or refreshed', () => {
		expect(unread.countsFor('acc-1')).toBeNull();
	});

	it('set stores counts for that account only', () => {
		unread.set('acc-1', { inbox: 3, starred: 0, spam: 0, snoozed: 0 });
		expect(unread.countsFor('acc-1')?.inbox).toBe(3);
		expect(unread.countsFor('acc-2')).toBeNull();
	});

	it('refresh fetches and stores counts for the given account', async () => {
		getMailboxCounts.mockResolvedValueOnce({ inbox: 5, starred: 1, spam: 0, snoozed: 0 });
		await unread.refresh('acc-1');
		expect(getMailboxCounts).toHaveBeenCalledWith('acc-1');
		expect(unread.countsFor('acc-1')?.inbox).toBe(5);
	});

	it('single-flights concurrent refreshes for the same account', async () => {
		let resolve: (v: unknown) => void = () => {};
		getMailboxCounts.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
		const p1 = unread.refresh('acc-1');
		const p2 = unread.refresh('acc-1');
		resolve({ inbox: 2, starred: 0, spam: 0, snoozed: 0 });
		await Promise.all([p1, p2]);
		expect(getMailboxCounts).toHaveBeenCalledTimes(1);
	});

	it('leaves the last known count in place on a failed refresh', async () => {
		unread.set('acc-1', { inbox: 7, starred: 0, spam: 0, snoozed: 0 });
		getMailboxCounts.mockRejectedValueOnce(new Error('network down'));
		await unread.refresh('acc-1');
		expect(unread.countsFor('acc-1')?.inbox).toBe(7);
	});

	it('forget removes a single account', () => {
		unread.set('acc-1', { inbox: 1, starred: 0, spam: 0, snoozed: 0 });
		unread.set('acc-2', { inbox: 2, starred: 0, spam: 0, snoozed: 0 });
		unread.forget('acc-1');
		expect(unread.countsFor('acc-1')).toBeNull();
		expect(unread.countsFor('acc-2')?.inbox).toBe(2);
	});

	it('clear removes every account', () => {
		unread.set('acc-1', { inbox: 1, starred: 0, spam: 0, snoozed: 0 });
		unread.set('acc-2', { inbox: 2, starred: 0, spam: 0, snoozed: 0 });
		unread.clear();
		expect(unread.countsFor('acc-1')).toBeNull();
		expect(unread.countsFor('acc-2')).toBeNull();
	});
});
