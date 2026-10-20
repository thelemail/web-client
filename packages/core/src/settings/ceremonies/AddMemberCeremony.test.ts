import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import AddMemberCeremony from './AddMemberCeremony.svelte';
import { customDomains } from '$core/stores/customDomains.svelte';
import { billing } from '$core/stores/billing.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import type { CreateWorkspaceInviteResult, Workspace, WorkspaceInvite } from '$core/api/workspaces';
import type { CustomDomain } from '$core/api/customDomains';
import type { Subscription } from '$core/api/billing';

vi.mock('$platform', () => ({ platform: { returnOrigin: () => 'https://mail.test' } }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'me' } }));

const at = '2026-09-21T12:00:00Z';
const hint = 'Use letters, numbers, dots, underscores or hyphens, starting and ending with a letter or number.';

function domain(): CustomDomain {
	return {
		id: 'd1',
		workspaceId: 'w1',
		domain: 'acme.test',
		status: 'ready',
		addressCount: 0,
		ownershipVerifiedAt: at,
		dkimVerifiedAt: at,
		spfVerifiedAt: at,
		dmarcVerifiedAt: at,
		createdAt: at,
		updatedAt: at
	};
}

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

async function typeLocal(value: string) {
	render(AddMemberCeremony, { props: { onClose: () => {}, onComplete: () => {} } });
	await fireEvent.input(document.querySelector('#add-mem-local')!, { target: { value } });
}

beforeEach(() => {
	billing.subscription = { planCode: 'business', seats: 5 } as Subscription;
	workspaces.workspace = { id: 'w1', ownerAccountId: 'me', name: 'Acme', type: 'business', createdAt: at, updatedAt: at } as Workspace;
	workspaces.members = [];
	workspaces.invites = [];
	customDomains.items = [domain()];
});

afterEach(() => {
	cleanup();
	customDomains.clear();
	billing.subscription = null;
	workspaces.workspace = null;
	workspaces.invites = [];
	vi.restoreAllMocks();
});

describe('AddMemberCeremony', () => {
	it('does not ask for a name', () => {
		render(AddMemberCeremony, { props: { onClose: () => {}, onComplete: () => {} } });

		expect(document.querySelector('#add-mem-name')).toBeNull();
		expect(document.body.textContent).not.toContain('Full name');
	});

	it.each(['a+b', '.a', 'a-'])('rejects %s with the rule as the hint', async (value) => {
		await typeLocal(value);

		expect(document.body.textContent).toContain(hint);
		expect(button('Add member')?.disabled).toBe(true);
	});

	it.each(['a_b', 'a.b-c'])('accepts %s', async (value) => {
		await typeLocal(value);

		expect(document.body.textContent).not.toContain(hint);
	});

	it('invites with the address only and says an invitation was created', async () => {
		const invite = vi.spyOn(workspaces, 'invite').mockResolvedValue({
			invite: { id: 'i1', email: 'camille@acme.test' } as WorkspaceInvite,
			token: 'tok'
		} as CreateWorkspaceInviteResult);
		await typeLocal('Camille');
		await fireEvent.click(button('Add member')!);
		await vi.waitFor(() => expect(button('Done')).toBeDefined());

		expect(invite).toHaveBeenCalledWith({
			customDomainId: 'd1',
			localPart: 'camille',
			role: 'member',
			deliverTo: undefined
		});
		expect(document.body.textContent).toContain('Invitation created');
		expect(document.body.textContent).toContain('camille@acme.test is set up once they accept.');
		expect(document.body.textContent).toContain('https://mail.test/invite/tok');
	});
});
