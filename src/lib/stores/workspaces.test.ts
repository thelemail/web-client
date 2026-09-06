import { describe, it, expect, vi, beforeEach } from 'vitest';

const createFamilyInvite = vi.fn();
const leaveMyWorkspace = vi.fn();

vi.mock('$lib/api/workspaces', () => ({
	getMyWorkspace: vi.fn(),
	listWorkspaceMembers: vi.fn(),
	listWorkspaceInvites: vi.fn(),
	createWorkspaceInvite: vi.fn(),
	createFamilyInvite: (...a: unknown[]) => createFamilyInvite(...a),
	leaveMyWorkspace: (...a: unknown[]) => leaveMyWorkspace(...a),
	deleteWorkspaceInvite: vi.fn(),
	resendWorkspaceInvite: vi.fn(),
	removeWorkspaceMember: vi.fn(),
	updateWorkspaceMember: vi.fn(),
	changeMyWorkspaceType: vi.fn(),
	setWorkspaceCatchAll: vi.fn()
}));

import { workspaces } from './workspaces.svelte';
import type { Workspace, WorkspaceMember, WorkspaceType } from '$lib/api/workspaces';

const OWNER = 'acc-owner';

function seat(accountId: string, role: WorkspaceMember['role']): WorkspaceMember {
	return {
		workspaceId: 'ws-1',
		accountId,
		email: `${accountId}@thelemail.com`,
		fullName: accountId,
		role,
		joinedAt: '2026-09-01T00:00:00Z'
	};
}

function asWorkspace(type: WorkspaceType): Workspace {
	return {
		id: 'ws-1',
		ownerAccountId: OWNER,
		name: 'Rossi',
		type,
		createdAt: '2026-09-01T00:00:00Z',
		updatedAt: '2026-09-01T00:00:00Z'
	};
}

function given(type: WorkspaceType, role: WorkspaceMember['role'] = 'owner') {
	workspaces.workspace = asWorkspace(type);
	workspaces.members = [seat(OWNER, role)];
	workspaces.invites = [];
}

describe('canInvite', () => {
	beforeEach(() => {
		createFamilyInvite.mockReset();
		leaveMyWorkspace.mockReset();
	});

	it('lets a free family invite with no domain at all', () => {
		given('family');
		expect(workspaces.canInvite(OWNER, { required: false, verifiedCount: 0 })).toBe(true);
	});

	it('still requires a proven domain on a paid workspace', () => {
		given('family');
		expect(workspaces.canInvite(OWNER, { required: true, verifiedCount: 0 })).toBe(false);
		expect(workspaces.canInvite(OWNER, { required: true, verifiedCount: 1 })).toBe(true);
	});

	it('never invites from a personal workspace', () => {
		given('personal');
		expect(workspaces.canInvite(OWNER, { required: false, verifiedCount: 3 })).toBe(false);
	});

	it('refuses a plain member', () => {
		given('family', 'member');
		expect(workspaces.canInvite(OWNER, { required: false, verifiedCount: 0 })).toBe(false);
	});
});

describe('inviteExisting', () => {
	beforeEach(() => {
		createFamilyInvite.mockReset();
		given('family');
	});

	it('posts the address and prepends the pending invite', async () => {
		const invite = { id: 'inv-1', workspaceId: 'ws-1', kind: 'join', email: 'anna@thelemail.com' };
		createFamilyInvite.mockResolvedValueOnce({ invite, token: 'tok' });

		const result = await workspaces.inviteExisting({ email: 'anna@thelemail.com' });

		expect(createFamilyInvite).toHaveBeenCalledWith('ws-1', { email: 'anna@thelemail.com' });
		expect(result.token).toBe('tok');
		expect(workspaces.invites[0]).toStrictEqual(invite);
	});
});

describe('leave', () => {
	beforeEach(() => {
		leaveMyWorkspace.mockReset();
		given('family', 'member');
		workspaces.invites = [];
	});

	it('swaps in the restored personal workspace and drops the family roster', async () => {
		const restored = asWorkspace('personal');
		restored.id = 'ws-new';
		leaveMyWorkspace.mockResolvedValueOnce(restored);

		const out = await workspaces.leave();

		expect(out.id).toBe('ws-new');
		expect(workspaces.workspace?.id).toBe('ws-new');
		expect(workspaces.members).toEqual([]);
		expect(workspaces.invites).toEqual([]);
	});
});
