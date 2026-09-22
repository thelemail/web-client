import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { CustomDomain } from '$core/api/customDomains';
import type { Workspace } from '$core/api/workspaces';
import { ApiCallError } from '$core/api/types';
import { customDomains } from '$core/stores/customDomains.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import DomainPage from './+page.svelte';

const api = vi.hoisted(() => ({
	listWorkspaceDomains: vi.fn(),
	createWorkspaceDomain: vi.fn(),
	getWorkspaceDomain: vi.fn(),
	startWorkspaceDomainCheck: vi.fn(),
	deleteWorkspaceDomain: vi.fn()
}));
vi.mock('$core/api/customDomains', () => api);

vi.mock('$app/navigation', () => ({ goto: vi.fn(), replaceState: vi.fn() }));
const nav = vi.hoisted(() => ({
	page: {
		params: { slot: '0', domainId: 'd1' },
		url: new URL('http://localhost/u/0/settings/domains/d1?step=ownership')
	}
}));
vi.mock('$app/state', () => nav);

vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));
vi.mock('$core/directory/lookup', () => ({ lookupDirectory: vi.fn() }));
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: vi.fn(),
	DirectoryVerificationError: class extends Error {}
}));

const at = '2026-09-22T12:00:00Z';

const listed: CustomDomain = {
	id: 'd1',
	workspaceId: 'w1',
	domain: 'acme.test',
	status: 'pending',
	addressCount: 0,
	actionableStage: 'ownership',
	createdAt: at,
	updatedAt: at
};

function currentStep() {
	return document.querySelector('.dw-rail [aria-current="step"] .dw-lbl')?.textContent?.trim();
}

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

function text() {
	return document.body.textContent ?? '';
}

beforeEach(() => {
	for (const fn of Object.values(api)) fn.mockReset();
	customDomains.setAccount('a1');
	workspaces.workspace = { id: 'w1', ownerAccountId: 'a1', name: 'Acme', type: 'business', createdAt: at, updatedAt: at } as Workspace;
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	customDomains.setAccount(null);
	workspaces.workspace = null;
	nav.page.url = new URL('http://localhost/u/0/settings/domains/d1?step=ownership');
});

describe('domain setup page', () => {
	it('says the domain is gone when the server no longer has it', async () => {
		customDomains.items = [listed];
		api.getWorkspaceDomain.mockRejectedValue(
			new ApiCallError(404, { error: { code: 'not_found', message: 'custom domain not found' } }, 'custom domain not found')
		);
		render(DomainPage);

		await vi.waitFor(() => expect(text()).toContain('This domain is no longer in your workspace.'));
		expect(text()).not.toContain('custom domain not found');
		expect(text()).not.toContain('Loading domain');
		expect(customDomains.items).toEqual([]);
	});

	it('says the domain is gone when it disappears while a check runs', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
		Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
		const running: CustomDomain = {
			...listed,
			check: {
				stage: 'ownership',
				state: 'running',
				startedAt: at,
				deadlineAt: '2026-09-24T12:00:00Z',
				attempts: 1,
				lastCheckedAt: at,
				nextCheckAt: '2026-09-22T12:05:00Z',
				result: null
			}
		};
		api.getWorkspaceDomain
			.mockResolvedValueOnce({ domain: running, records: [] })
			.mockRejectedValue(new ApiCallError(404, { error: { code: 'not_found', message: 'custom domain not found' } }, 'custom domain not found'));
		render(DomainPage);
		await vi.advanceTimersByTimeAsync(0);
		expect(text()).toContain('Ownership verification in progress.');

		await vi.advanceTimersByTimeAsync(30_000);
		expect(text()).toContain('This domain is no longer in your workspace.');
		expect(text()).not.toContain('Loading domain');

		await vi.advanceTimersByTimeAsync(5 * 60_000);
		expect(api.getWorkspaceDomain).toHaveBeenCalledTimes(2);
	});

	it('shows its own copy instead of the server message when loading fails', async () => {
		api.getWorkspaceDomain.mockRejectedValue(
			new ApiCallError(500, { error: { code: 'internal_error', message: 'pq: connection refused' } }, 'pq: connection refused')
		);
		render(DomainPage);

		await vi.waitFor(() => expect(text()).toContain('Could not load this domain'));
		expect(text()).not.toContain('pq: connection refused');
	});

	it('stays on the clamped step when ownership verifies after a deep link further ahead', async () => {
		nav.page.url = new URL('http://localhost/u/0/settings/domains/d1?step=routing');
		api.getWorkspaceDomain.mockResolvedValue({ domain: listed, records: [] });
		render(DomainPage);

		await vi.waitFor(() => expect(currentStep()).toBe('Ownership'));
		expect(button('Continue')?.disabled).toBe(true);

		customDomains.items = [{ ...listed, status: 'owned', ownershipVerifiedAt: at, actionableStage: 'sending' }];
		await vi.waitFor(() => expect(button('Continue')?.disabled).toBe(false));
		expect(currentStep()).toBe('Ownership');

		await fireEvent.click(button('Continue')!);
		expect(currentStep()).toBe('Sending');
	});
});
