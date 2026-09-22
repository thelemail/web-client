import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { Subscription } from '$core/api/billing';
import type { CustomDomain } from '$core/api/customDomains';
import type { Workspace } from '$core/api/workspaces';
import { ApiCallError } from '$core/api/types';
import { billing } from '$core/stores/billing.svelte';
import { customDomains } from '$core/stores/customDomains.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import NewDomainPage from './+page.svelte';

const api = vi.hoisted(() => ({
	listWorkspaceDomains: vi.fn(),
	createWorkspaceDomain: vi.fn(),
	getWorkspaceDomain: vi.fn(),
	startWorkspaceDomainCheck: vi.fn(),
	deleteWorkspaceDomain: vi.fn()
}));
vi.mock('$core/api/customDomains', () => api);

const nav = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => nav);
vi.mock('$app/state', () => ({ page: { params: { slot: '0' } } }));

const at = '2026-09-22T12:00:00Z';

function created(domain: string): CustomDomain {
	return {
		id: 'd1',
		workspaceId: 'w1',
		domain,
		status: 'pending',
		addressCount: 0,
		actionableStage: 'ownership',
		createdAt: at,
		updatedAt: at
	};
}

function continueButton() {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Continue');
}

async function enter(value: string) {
	await fireEvent.input(document.querySelector('#new-domain-name')!, { target: { value } });
}

beforeEach(() => {
	api.createWorkspaceDomain.mockReset();
	nav.goto.mockReset().mockResolvedValue(undefined);
	billing.subscription = { planCode: 'business' } as Subscription;
	workspaces.workspace = { id: 'w1', ownerAccountId: 'a1', name: 'Acme', type: 'business', createdAt: at, updatedAt: at } as Workspace;
});

afterEach(() => {
	cleanup();
	customDomains.clear();
	billing.subscription = null;
	workspaces.workspace = null;
});

describe('new domain page', () => {
	it('adds an international name in its ASCII form and opens the ownership step', async () => {
		api.createWorkspaceDomain.mockResolvedValue({ domain: created('xn--bcher-kva.de'), records: [] });
		render(NewDomainPage);

		await enter('https://Bücher.de/');
		await fireEvent.click(continueButton()!);

		expect(api.createWorkspaceDomain).toHaveBeenCalledWith('w1', 'xn--bcher-kva.de');
		await vi.waitFor(() =>
			expect(nav.goto).toHaveBeenCalledWith('/u/0/settings/domains/d1?step=ownership', { replaceState: true })
		);
	});

	it('keeps Continue off for something that is not a domain', async () => {
		render(NewDomainPage);

		await enter('example.com:25');

		expect(continueButton()?.disabled).toBe(true);
		expect(document.body.textContent).toContain('Enter a bare domain like');
	});

	it('explains a domain the workspace already has instead of the server text', async () => {
		api.createWorkspaceDomain.mockRejectedValue(
			new ApiCallError(409, { error: { code: 'conflict', message: 'domain already in use' } }, 'domain already in use')
		);
		render(NewDomainPage);

		await enter('acme.co.uk');
		await fireEvent.click(continueButton()!);

		await vi.waitFor(() => expect(document.body.textContent).toContain('This domain is already in your workspace.'));
		expect(document.body.textContent).not.toContain('domain already in use');
		expect(continueButton()?.disabled).toBe(false);
	});

	it('explains a name that cannot be connected', async () => {
		api.createWorkspaceDomain.mockRejectedValue(
			new ApiCallError(400, { error: { code: 'invalid_request', message: 'this domain cannot be connected' } }, 'x')
		);
		render(NewDomainPage);

		await enter('mail.thelemail.com');
		await fireEvent.click(continueButton()!);

		await vi.waitFor(() => expect(document.body.textContent).toContain('This domain cannot be added.'));
	});
});
