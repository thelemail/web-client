import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import MembershipCard from './MembershipCard.svelte';
import { billing } from '$core/stores/billing.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import type { Plan, Subscription } from '$core/api/billing';
import type { Workspace, WorkspaceMember } from '$core/api/workspaces';

vi.mock('$platform', () => ({ platform: { returnOrigin: () => 'https://mail.test' } }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'me' } }));
vi.mock('$core/stores/accountData', () => ({ reloadWorkspaceData: vi.fn() }));

const at = '2026-10-01T12:00:00Z';

const freeFamily: Plan = {
	code: 'free_family',
	workspaceType: 'family',
	displayName: 'Free Family',
	pricingModel: 'flat',
	currency: 'eur',
	yearlyAmountCents: 0,
	monthlyAmountCents: 0,
	minSeats: 1,
	maxSeats: 4,
	storageBytesPerMailbox: 1024 ** 3,
	customDomainsLimit: 0,
	auditRetentionDays: 30,
	prioritySupport: 'none'
};

function member(i: number): WorkspaceMember {
	return {
		workspaceId: 'w1',
		accountId: i === 0 ? 'me' : `m${i}`,
		email: `p${i}@temail.org`,
		fullName: `Person ${i}`,
		role: i === 0 ? 'owner' : 'member',
		joinedAt: at
	};
}

function addButton() {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Add a family member'));
}

beforeEach(() => {
	billing.catalog = { plans: [freeFamily] };
	billing.subscription = { status: 'active', entitled: true, planCode: 'free_family', cancelAtPeriodEnd: false } as Subscription;
	workspaces.workspace = { id: 'w1', ownerAccountId: 'me', name: 'Home', type: 'family', createdAt: at, updatedAt: at } as Workspace;
	workspaces.invites = [];
});

afterEach(() => {
	cleanup();
	billing.catalog = null;
	billing.subscription = null;
	workspaces.workspace = null;
	workspaces.members = [];
});

describe('MembershipCard', () => {
	it('counts seats against the catalog limit', () => {
		workspaces.members = [0, 1].map(member);
		render(MembershipCard, { props: { launch: () => {} } });

		expect(document.querySelectorAll('.seat-dot')).toHaveLength(4);
		expect(document.querySelector('.seat-text')?.textContent).toMatch(/2.*4/);
		expect(addButton()).toBeDefined();
	});

	it('stops inviting once the catalog limit is reached', () => {
		workspaces.members = [0, 1, 2, 3].map(member);
		render(MembershipCard, { props: { launch: () => {} } });

		expect(addButton()).toBeUndefined();
		expect(document.body.textContent).toContain('All 4 seats are in use');
	});

	it('shows no limit before the catalog loads', () => {
		billing.catalog = { plans: [] };
		workspaces.members = [0, 1].map(member);
		render(MembershipCard, { props: { launch: () => {} } });

		expect(document.querySelectorAll('.seat-dot')).toHaveLength(0);
		expect(document.body.textContent).not.toMatch(/\b6\b/);
	});
});
