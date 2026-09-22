import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomDomain, CustomDomainWithRecords } from '$core/api/customDomains';
import { ApiCallError } from '$core/api/types';

const api = vi.hoisted(() => ({
	listWorkspaceDomains: vi.fn(),
	createWorkspaceDomain: vi.fn(),
	getWorkspaceDomain: vi.fn(),
	startWorkspaceDomainCheck: vi.fn(),
	deleteWorkspaceDomain: vi.fn()
}));
vi.mock('$core/api/customDomains', () => api);

import { customDomains } from './customDomains.svelte';

const at = '2026-09-22T12:00:00Z';

function domain(over: Partial<CustomDomain> = {}): CustomDomain {
	return {
		id: 'd1',
		workspaceId: 'w1',
		domain: 'acme.test',
		status: 'pending',
		addressCount: 0,
		actionableStage: 'ownership',
		createdAt: at,
		updatedAt: at,
		...over
	};
}

function withRecords(d: CustomDomain): CustomDomainWithRecords {
	return { domain: d, records: [] };
}

const running = domain({
	check: {
		stage: 'ownership',
		state: 'running',
		startedAt: at,
		deadlineAt: '2026-09-24T12:00:00Z',
		attempts: 1,
		lastCheckedAt: at,
		nextCheckAt: '2026-09-22T12:05:00Z',
		result: 'ownership_missing'
	}
});

beforeEach(() => {
	customDomains.setAccount('a1');
	for (const fn of Object.values(api)) fn.mockReset();
});

afterEach(() => {
	customDomains.setAccount(null);
});

describe('customDomains store', () => {
	it('stores the domain returned by a started check', async () => {
		customDomains.items = [domain()];
		api.startWorkspaceDomainCheck.mockResolvedValue(withRecords(running));

		await customDomains.startCheck('w1', 'd1', 'ownership');

		expect(api.startWorkspaceDomainCheck).toHaveBeenCalledWith('w1', 'd1', 'ownership');
		expect(customDomains.items[0].check?.state).toBe('running');
	});

	it('refreshes the domain when the server refuses to start a check', async () => {
		customDomains.items = [domain()];
		api.startWorkspaceDomainCheck.mockRejectedValue(
			new ApiCallError(409, { error: { code: 'conflict', message: 'check running' } }, 'check running')
		);
		api.getWorkspaceDomain.mockResolvedValue(withRecords(running));

		await expect(customDomains.startCheck('w1', 'd1', 'ownership')).rejects.toBeInstanceOf(ApiCallError);

		expect(api.getWorkspaceDomain).toHaveBeenCalledWith('w1', 'd1');
		expect(customDomains.items[0].check?.state).toBe('running');
	});

	it('refreshes the domain after a rate limit too', async () => {
		customDomains.items = [domain()];
		api.startWorkspaceDomainCheck.mockRejectedValue(
			new ApiCallError(429, { error: { code: 'rate_limited', message: 'slow down' } }, 'slow down')
		);
		api.getWorkspaceDomain.mockResolvedValue(withRecords(running));

		await expect(customDomains.startCheck('w1', 'd1', 'ownership')).rejects.toBeInstanceOf(ApiCallError);

		expect(api.getWorkspaceDomain).toHaveBeenCalledTimes(1);
	});

	it('does not refetch after other failures', async () => {
		customDomains.items = [domain()];
		api.startWorkspaceDomainCheck.mockRejectedValue(new Error('offline'));

		await expect(customDomains.startCheck('w1', 'd1', 'ownership')).rejects.toThrow('offline');

		expect(api.getWorkspaceDomain).not.toHaveBeenCalled();
	});

	it('replaces the list on a background refresh', async () => {
		customDomains.items = [domain()];
		api.listWorkspaceDomains.mockResolvedValue({ domains: [running] });

		await customDomains.refresh('w1');

		expect(customDomains.items[0].check?.state).toBe('running');
		expect(customDomains.loading).toBe(false);
	});

	it('keeps the list when a background refresh fails', async () => {
		customDomains.items = [domain()];
		api.listWorkspaceDomains.mockRejectedValue(new Error('offline'));

		await expect(customDomains.refresh('w1')).rejects.toThrow('offline');

		expect(customDomains.items).toHaveLength(1);
		expect(customDomains.error).toBeNull();
	});

	it('drops a refresh that lands after the account changed', async () => {
		customDomains.items = [domain()];
		let resolve: (v: { domains: CustomDomain[] }) => void = () => {};
		api.listWorkspaceDomains.mockReturnValue(new Promise((r) => (resolve = r)));

		const pending = customDomains.refresh('w1');
		customDomains.setAccount('a2');
		resolve({ domains: [running] });
		await pending;

		expect(customDomains.items).toEqual([]);
	});
});
