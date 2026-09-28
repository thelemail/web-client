import { describe, expect, it } from 'vitest';
import { reauth } from './reauth.svelte';

describe('reauth prompt', () => {
	it('shares one prompt between concurrent requests for the same account', async () => {
		const a = reauth.request('acct-1');
		const b = reauth.request('acct-1');
		expect(reauth.accountId).toBe('acct-1');
		reauth.settle(true);
		await expect(a).resolves.toBe(true);
		await expect(b).resolves.toBe(true);
		expect(reauth.accountId).toBeNull();
	});

	it('queues a request for another account behind the open prompt', async () => {
		const first = reauth.request('acct-1');
		const second = reauth.request('acct-2');
		expect(reauth.accountId).toBe('acct-1');
		reauth.settle(false);
		await expect(first).resolves.toBe(false);
		await Promise.resolve();
		await Promise.resolve();
		expect(reauth.accountId).toBe('acct-2');
		reauth.settle(true);
		await expect(second).resolves.toBe(true);
	});
});
