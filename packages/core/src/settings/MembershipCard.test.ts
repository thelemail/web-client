import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import MembershipCard from './MembershipCard.svelte';
import { billing } from '$core/stores/billing.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import type { Plan, Subscription } from '$core/api/billing';
import type { Workspace, WorkspaceInvite, WorkspaceMember } from '$core/api/workspaces';
import { ApiCallError } from '$core/api/types';

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
	vi.restoreAllMocks();
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

describe('MembershipCard action errors', () => {
	const invite: WorkspaceInvite = {
		id: 'i1',
		workspaceId: 'w1',
		kind: 'family',
		email: 'new@temail.org',
		role: 'member',
		createdAt: at,
		expiresAt: at
	};

	function row(addr: string): HTMLElement {
		return [...document.querySelectorAll('.mbr-row')].find((r) => r.textContent?.includes(addr)) as HTMLElement;
	}

	async function menu(addr: string, item: RegExp) {
		await fireEvent.click(within(row(addr)).getByRole('button', { name: 'Actions' }));
		await fireEvent.click(screen.getByRole('button', { name: item }));
	}

	function setClipboard(impl: () => Promise<void>) {
		Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(impl) }, configurable: true });
	}

	it('shows why a role change failed and clears the busy state', async () => {
		workspaces.members = [0, 1].map(member);
		vi.spyOn(workspaces, 'changeRole').mockRejectedValue(
			new ApiCallError(403, { error: { code: 'forbidden', message: 'forbidden' } }, 'forbidden')
		);
		render(MembershipCard, { props: { launch: () => {} } });

		await menu('p1@temail.org', /Make admin/);
		await vi.waitFor(() =>
			expect(screen.getByRole('alert').textContent).toContain('You don’t have permission to do that in this workspace.')
		);
		expect(document.body.textContent).not.toContain('forbidden');
		expect(within(row('p1@temail.org')).getByRole('button', { name: 'Actions' }).hasAttribute('disabled')).toBe(false);
	});

	it('shows a translated message for a failed revoke', async () => {
		workspaces.members = [member(0)];
		workspaces.invites = [invite];
		vi.spyOn(workspaces, 'revokeInvite').mockRejectedValue(new TypeError('Failed to fetch'));
		render(MembershipCard, { props: { launch: () => {} } });

		await menu('new@temail.org', /Revoke invitation/);
		await fireEvent.click(within(row('new@temail.org')).getByRole('button', { name: 'Revoke' }));
		await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Couldn’t revoke the invitation.'));
		expect(document.body.textContent).not.toContain('Failed to fetch');
	});

	it('says the invite went out and shows the link when copying fails', async () => {
		workspaces.members = [member(0)];
		workspaces.invites = [invite];
		vi.spyOn(workspaces, 'resendInvite').mockResolvedValue({ invite, token: 'tok123' } as never);
		setClipboard(() => Promise.reject(new Error('denied')));
		render(MembershipCard, { props: { launch: () => {} } });

		await menu('new@temail.org', /new invitation link/i);
		await vi.waitFor(() =>
			expect(screen.getByRole('status').textContent).toContain('Invitation sent again, but the new link couldn’t be copied.')
		);
		expect(screen.getByRole('status').textContent).toContain('https://mail.test/invite/tok123');
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('confirms a copied link after a resend', async () => {
		workspaces.members = [member(0)];
		workspaces.invites = [invite];
		vi.spyOn(workspaces, 'resendInvite').mockResolvedValue({ invite, token: 'tok123' } as never);
		setClipboard(() => Promise.resolve());
		render(MembershipCard, { props: { launch: () => {} } });

		await menu('new@temail.org', /new invitation link/i);
		await vi.waitFor(() => expect(screen.getByRole('status').textContent).toContain('New link copied'));
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://mail.test/invite/tok123');
	});
});
