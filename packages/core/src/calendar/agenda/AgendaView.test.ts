import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { CustomDomain } from '$core/api/customDomains';
import type { Workspace, WorkspaceMember } from '$core/api/workspaces';
import { customDomains } from '$core/stores/customDomains.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import AgendaView from './AgendaView.svelte';

vi.mock('../store.svelte', () => ({ calendarStore: {} }));
vi.mock('../state.svelte', () => ({ cal: { agendaDays: [], title: 'September' } }));

const at = '2026-09-20T12:00:00Z';

function domain(id: string, name: string, over: Partial<CustomDomain> = {}): CustomDomain {
	return {
		id,
		workspaceId: 'w1',
		domain: name,
		status: 'pending',
		addressCount: 0,
		actionableStage: 'ownership',
		createdAt: at,
		updatedAt: at,
		...over
	};
}

const sending = { ownershipVerifiedAt: at, dkimVerifiedAt: at, spfVerifiedAt: at, dmarcVerifiedAt: at };
const live = { status: 'active' as const, ...sending, mxVerifiedAt: at, addressCount: 2, actionableStage: null };

function hero() {
	return document.querySelector('.agh-s')?.textContent ?? '';
}

beforeEach(() => {
	workspaces.workspace = { id: 'w1', ownerAccountId: 'a1', name: 'Acme', type: 'business', createdAt: at, updatedAt: at } as Workspace;
	workspaces.members = [{ accountId: 'a1' } as WorkspaceMember, { accountId: 'a2' } as WorkspaceMember];
});

afterEach(() => {
	cleanup();
	customDomains.clear();
	workspaces.workspace = null;
	workspaces.members = [];
});

describe('AgendaView hero', () => {
	it('names the live domain rather than the first one added', () => {
		customDomains.items = [domain('d1', 'pending.test'), domain('d2', 'acme.test', live)];
		render(AgendaView);

		expect(hero()).toContain('behind acme.test.');
	});

	it('falls back to a domain the workspace has proven it owns', () => {
		customDomains.items = [domain('d1', 'pending.test'), domain('d2', 'acme.test', { status: 'owned', ownershipVerifiedAt: at })];
		render(AgendaView);

		expect(hero()).toContain('behind acme.test.');
	});

	it('names the shared domain when no custom domain is live', () => {
		customDomains.items = [
			domain('d1', 'pending.test'),
			domain('d2', 'paused.test', { ...live, dormantAt: at })
		];
		render(AgendaView);

		expect(hero()).toContain('behind thelemail.com.');
	});
});
