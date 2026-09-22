import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { CustomDomain } from '$core/api/customDomains';
import type { Workspace } from '$core/api/workspaces';
import { customDomains } from '$core/stores/customDomains.svelte';
import { addresses } from '$core/stores/addresses.svelte';
import { aliases } from '$core/stores/aliases.svelte';
import { workspaceAddresses } from '$core/stores/workspaceAddresses.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import RemoveDomainDialog from './RemoveDomainDialog.svelte';

const api = vi.hoisted(() => ({
	listWorkspaceDomains: vi.fn(),
	createWorkspaceDomain: vi.fn(),
	getWorkspaceDomain: vi.fn(),
	startWorkspaceDomainCheck: vi.fn(),
	deleteWorkspaceDomain: vi.fn()
}));
vi.mock('$core/api/customDomains', () => api);

vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'a1' } }));

const at = '2026-09-20T12:00:00Z';

const domain: CustomDomain = {
	id: 'd1',
	workspaceId: 'w1',
	domain: 'acme.test',
	status: 'active',
	ownershipVerifiedAt: at,
	addressCount: 2,
	actionableStage: null,
	createdAt: at,
	updatedAt: at
};

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

let reloads: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
	api.deleteWorkspaceDomain.mockReset().mockResolvedValue(undefined);
	workspaces.workspace = { id: 'w1', ownerAccountId: 'a1', name: 'Acme', type: 'business', createdAt: at, updatedAt: at } as Workspace;
	customDomains.items = [domain];
	reloads = {
		addresses: vi.fn().mockResolvedValue(undefined),
		aliases: vi.fn().mockResolvedValue(undefined),
		workspaceAddresses: vi.fn().mockResolvedValue(undefined),
		workspace: vi.fn().mockResolvedValue(undefined)
	};
	vi.spyOn(addresses, 'load').mockImplementation(reloads.addresses);
	vi.spyOn(aliases, 'load').mockImplementation(reloads.aliases);
	vi.spyOn(workspaceAddresses, 'reload').mockImplementation(reloads.workspaceAddresses);
	vi.spyOn(workspaces, 'load').mockImplementation(reloads.workspace);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	customDomains.clear();
	workspaces.workspace = null;
});

describe('RemoveDomainDialog', () => {
	it('says shared addresses and invitations go with the domain', () => {
		render(RemoveDomainDialog, { props: { domain, onClose: vi.fn(), onRemoved: vi.fn() } });

		expect(document.body.textContent).toContain(
			'Shared addresses and open invitations on this domain are removed too'
		);
	});

	it('reloads addresses, shared addresses and the workspace after removal', async () => {
		const onRemoved = vi.fn();
		render(RemoveDomainDialog, { props: { domain, onClose: vi.fn(), onRemoved } });

		await fireEvent.click(document.querySelector('input[type="checkbox"]')!);
		await fireEvent.input(document.querySelector('#rm-domain-confirm')!, { target: { value: 'acme.test' } });
		await fireEvent.click(button('Remove domain')!);
		await vi.waitFor(() => expect(onRemoved).toHaveBeenCalledWith('acme.test'));

		expect(api.deleteWorkspaceDomain).toHaveBeenCalledWith('w1', 'd1');
		expect(customDomains.items).toEqual([]);
		expect(reloads.addresses).toHaveBeenCalledTimes(1);
		expect(reloads.aliases).toHaveBeenCalledWith('w1');
		expect(reloads.workspaceAddresses).toHaveBeenCalledTimes(1);
		expect(reloads.workspace).toHaveBeenCalledWith('a1');
	});

	it('reloads nothing when removal fails', async () => {
		api.deleteWorkspaceDomain.mockRejectedValue(new Error('nope'));
		render(RemoveDomainDialog, { props: { domain, onClose: vi.fn(), onRemoved: vi.fn() } });

		await fireEvent.click(document.querySelector('input[type="checkbox"]')!);
		await fireEvent.input(document.querySelector('#rm-domain-confirm')!, { target: { value: 'acme.test' } });
		await fireEvent.click(button('Remove domain')!);
		await vi.waitFor(() => expect(document.body.textContent).toContain('nope'));

		expect(reloads.aliases).not.toHaveBeenCalled();
		expect(reloads.workspace).not.toHaveBeenCalled();
	});
});
