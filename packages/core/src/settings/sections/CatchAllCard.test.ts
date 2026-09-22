import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { CustomDomain } from '$core/api/customDomains';
import type { AccountAddress } from '$core/api/addresses';
import type { Workspace } from '$core/api/workspaces';
import { addresses } from '$core/stores/addresses.svelte';
import { customDomains } from '$core/stores/customDomains.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import CatchAllCard from './CatchAllCard.svelte';

const at = '2026-09-20T12:00:00Z';

function domain(id: string, over: Partial<CustomDomain> = {}): CustomDomain {
	return {
		id,
		workspaceId: 'w1',
		domain: `${id}.test`,
		status: 'ready',
		ownershipVerifiedAt: at,
		dkimVerifiedAt: at,
		spfVerifiedAt: at,
		dmarcVerifiedAt: at,
		addressCount: 1,
		actionableStage: null,
		createdAt: at,
		updatedAt: at,
		...over
	};
}

function address(id: string, customDomainId: string): AccountAddress {
	const email = `me@${customDomainId}.test`;
	return {
		id,
		accountId: 'a1',
		email,
		localPart: 'me',
		customDomainId,
		isPrimary: false,
		createdAt: at,
		updatedAt: at
	};
}

function workspace(catchAllAddressId: string | null): Workspace {
	return { id: 'w1', ownerAccountId: 'a1', name: 'Acme', type: 'business', catchAllAddressId, createdAt: at, updatedAt: at } as Workspace;
}

function text() {
	return document.body.textContent ?? '';
}

const NEED_ADDRESS = 'Add an address on a verified custom domain before enabling catch-all.';

afterEach(() => {
	cleanup();
	customDomains.clear();
	addresses.items = [];
	workspaces.workspace = null;
});

describe('CatchAllCard', () => {
	it('keeps catch-all off until an address sits on a domain that can send', () => {
		customDomains.items = [domain('d1', { status: 'owned', dkimVerifiedAt: null })];
		addresses.items = [address('x1', 'd1')];
		workspaces.workspace = workspace(null);
		render(CatchAllCard);

		expect(text()).toContain(NEED_ADDRESS);
		expect(document.querySelector('[role="switch"]')).toBeNull();
	});

	it('offers catch-all for an address on a domain that can send', () => {
		customDomains.items = [domain('d1')];
		addresses.items = [address('x1', 'd1')];
		workspaces.workspace = workspace(null);
		render(CatchAllCard);

		expect(text()).not.toContain(NEED_ADDRESS);
		expect(document.querySelector('[role="switch"]')).not.toBeNull();
	});

	it('leaves addresses on a domain with a missing ownership record out', () => {
		customDomains.items = [domain('d1', { ownershipMissingSince: at, releaseAt: '2026-09-23T12:00:00Z' })];
		addresses.items = [address('x1', 'd1')];
		workspaces.workspace = workspace(null);
		render(CatchAllCard);

		expect(text()).toContain(NEED_ADDRESS);
	});

	it('still lets an admin turn off a catch-all whose domain stopped being usable', () => {
		customDomains.items = [domain('d1', { dormantAt: at })];
		addresses.items = [address('x1', 'd1')];
		workspaces.workspace = workspace('x1');
		render(CatchAllCard);

		expect(text()).not.toContain(NEED_ADDRESS);
		expect(document.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
	});
});
