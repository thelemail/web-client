import { browser } from '$app/environment';
import {
	getMyWorkspace,
	listWorkspaceMembers,
	listWorkspaceInvites,
	createWorkspaceInvite,
	deleteWorkspaceInvite,
	resendWorkspaceInvite,
	removeWorkspaceMember,
	updateWorkspaceMember,
	changeMyWorkspaceType,
	setWorkspaceCatchAll,
	type ChangeWorkspaceTypeInput,
	type CreateWorkspaceInviteInput,
	type CreateWorkspaceInviteResult,
	type InvitableRole,
	type Workspace,
	type WorkspaceInvite,
	type WorkspaceMember
} from '$lib/api/workspaces';

class WorkspaceStore {
	workspace = $state<Workspace | null>(null);
	members = $state<WorkspaceMember[]>([]);
	invites = $state<WorkspaceInvite[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	#accountId = $state<string | null>(null);

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.clear();
	}

	currentMember = $derived.by(() => {
		const caller = this.#accountId;
		if (!caller || !this.workspace) return null;
		return this.members.find((m) => m.accountId === caller) ?? null;
	});

	myRole = $derived(this.currentMember?.role ?? null);

	isOwner(callerAccountId: string | null): boolean {
		if (!callerAccountId || !this.workspace) return false;
		return this.workspace.ownerAccountId === callerAccountId;
	}

	async load(callerAccountId: string | null): Promise<void> {
		if (!browser) return;
		const acct = this.#accountId;
		this.loading = true;
		this.error = null;
		try {
			const workspace = await getMyWorkspace();
			if (this.#accountId !== acct) return;
			this.workspace = workspace;
			await this.loadActiveDetails(callerAccountId);
		} catch (err) {
			if (this.#accountId !== acct) return;
			this.error = err instanceof Error ? err.message : 'failed to load workspace';
			this.workspace = null;
			this.members = [];
			this.invites = [];
		} finally {
			if (this.#accountId === acct) this.loading = false;
		}
	}

	async loadActiveDetails(callerAccountId: string | null = null): Promise<void> {
		const acct = this.#accountId;
		const id = this.workspace?.id;
		if (!id) return;
		try {
			const { members } = await listWorkspaceMembers(id);
			if (this.#accountId !== acct) return;
			this.members = members;
			if (this.canManage(callerAccountId)) {
				const { invites } = await listWorkspaceInvites(id);
				if (this.#accountId !== acct) return;
				this.invites = invites;
			} else {
				this.invites = [];
			}
		} catch (err) {
			if (this.#accountId !== acct) return;
			this.error = err instanceof Error ? err.message : 'failed to load workspace';
		}
	}

	canManage(callerAccountId: string | null = null): boolean {
		const me = callerAccountId
			? this.members.find((m) => m.accountId === callerAccountId)
			: this.currentMember;
		return me?.role === 'owner' || me?.role === 'admin';
	}

	async invite(input: CreateWorkspaceInviteInput): Promise<CreateWorkspaceInviteResult> {
		const id = this.workspace?.id;
		if (!id) throw new Error('no workspace');
		const result = await createWorkspaceInvite(id, input);
		this.invites = [result.invite, ...this.invites];
		return result;
	}

	canInvite(callerAccountId: string | null, verifiedDomainCount: number): boolean {
		if (!this.canManage(callerAccountId)) return false;
		if (this.workspace?.type === 'personal') return false;
		return verifiedDomainCount > 0;
	}

	async resendInvite(inviteId: string): Promise<CreateWorkspaceInviteResult> {
		const result = await resendWorkspaceInvite(inviteId);
		this.invites = this.invites.map((i) => (i.id === inviteId ? result.invite : i));
		return result;
	}

	async revokeInvite(inviteId: string): Promise<void> {
		await deleteWorkspaceInvite(inviteId);
		this.invites = this.invites.filter((i) => i.id !== inviteId);
	}

	async removeMember(accountId: string): Promise<void> {
		const id = this.workspace?.id;
		if (!id) throw new Error('no workspace');
		await removeWorkspaceMember(id, accountId);
		this.members = this.members.filter((m) => m.accountId !== accountId);
	}

	async changeRole(accountId: string, role: InvitableRole): Promise<void> {
		const id = this.workspace?.id;
		if (!id) throw new Error('no workspace');
		const updated = await updateWorkspaceMember(id, accountId, role);
		this.members = this.members.map((m) =>
			m.accountId === accountId ? { ...m, role: updated.role } : m
		);
	}

	async changeType(input: ChangeWorkspaceTypeInput): Promise<Workspace> {
		const updated = await changeMyWorkspaceType(input);
		this.workspace = updated;
		return updated;
	}

	async setCatchAll(addressId: string | null): Promise<Workspace> {
		const updated = await setWorkspaceCatchAll(addressId);
		this.workspace = updated;
		return updated;
	}

	clear(): void {
		this.workspace = null;
		this.members = [];
		this.invites = [];
		this.error = null;
	}
}

export const workspaces = new WorkspaceStore();
