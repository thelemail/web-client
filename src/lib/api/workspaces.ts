import { apiFetch } from './client';
import type { RegisterRequest } from './types';

export type WorkspaceType = 'personal' | 'family' | 'business';
export type WorkspaceMemberRole = 'owner' | 'admin' | 'member';
export type InvitableRole = 'admin' | 'member';

export interface Workspace {
	id: string;
	ownerAccountId: string;
	name: string;
	type: WorkspaceType;
	catchAllAddressId?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface WorkspaceMember {
	workspaceId: string;
	accountId: string;
	email: string;
	fullName: string;
	role: WorkspaceMemberRole;
	joinedAt: string;
}

export interface WorkspaceInvite {
	id: string;
	workspaceId: string;
	customDomainId: string;
	email: string;
	role: InvitableRole;
	createdAt: string;
	expiresAt: string;
}

export interface UpdateWorkspaceInput {
	name: string;
}

export interface ChangeWorkspaceTypeInput {
	type: WorkspaceType;
	name?: string;
}

export interface CreateWorkspaceInviteInput {
	customDomainId: string;
	localPart: string;
	role: InvitableRole;
}

export interface CreateWorkspaceInviteResult {
	invite: WorkspaceInvite;
	token: string;
}

export interface WorkspaceInvitePreview {
	workspaceName: string;
	workspaceType: WorkspaceType;
	inviterDisplayName: string;
	inviteeEmail: string;
	customDomainId: string;
	customDomainName: string;
	role: InvitableRole;
	expiresAt: string;
}

export interface AcceptWorkspaceInviteResult {
	workspace: Workspace;
	member: WorkspaceMember;
	accessToken: string;
	tokenType: 'Bearer';
	expiresInSeconds: number;
	accountId: string;
	serverHalf?: string;
}

export function getMyWorkspace(): Promise<Workspace> {
	return apiFetch('/v1/me/workspace');
}

export function changeMyWorkspaceType(input: ChangeWorkspaceTypeInput): Promise<Workspace> {
	return apiFetch('/v1/me/workspace', { method: 'PATCH', body: input });
}

export function setWorkspaceCatchAll(addressId: string | null): Promise<Workspace> {
	return apiFetch('/v1/me/workspace/catch-all', {
		method: 'PUT',
		body: { addressId }
	});
}

export function getWorkspace(workspaceId: string): Promise<Workspace> {
	return apiFetch(`/v1/workspaces/${workspaceId}`);
}

export function updateWorkspace(
	workspaceId: string,
	input: UpdateWorkspaceInput
): Promise<Workspace> {
	return apiFetch(`/v1/workspaces/${workspaceId}`, { method: 'PATCH', body: input });
}

export function listWorkspaceMembers(
	workspaceId: string
): Promise<{ members: WorkspaceMember[] }> {
	return apiFetch(`/v1/workspaces/${workspaceId}/members`);
}

export function updateWorkspaceMember(
	workspaceId: string,
	accountId: string,
	role: InvitableRole
): Promise<WorkspaceMember> {
	return apiFetch(`/v1/workspaces/${workspaceId}/members/${accountId}`, {
		method: 'PATCH',
		body: { role }
	});
}

export function removeWorkspaceMember(workspaceId: string, accountId: string): Promise<void> {
	return apiFetch(`/v1/workspaces/${workspaceId}/members/${accountId}`, { method: 'DELETE' });
}

export function listWorkspaceInvites(
	workspaceId: string
): Promise<{ invites: WorkspaceInvite[] }> {
	return apiFetch(`/v1/workspaces/${workspaceId}/invites`);
}

export function createWorkspaceInvite(
	workspaceId: string,
	input: CreateWorkspaceInviteInput
): Promise<CreateWorkspaceInviteResult> {
	return apiFetch(`/v1/workspaces/${workspaceId}/invites`, { method: 'POST', body: input });
}

export function deleteWorkspaceInvite(inviteId: string): Promise<void> {
	return apiFetch(`/v1/workspace-invites/${inviteId}`, { method: 'DELETE' });
}

export function previewWorkspaceInvite(token: string): Promise<WorkspaceInvitePreview> {
	const params = new URLSearchParams({ token });
	return apiFetch(`/v1/workspace-invites/preview?${params.toString()}`, { skipAuth: true });
}

export interface RegisterFromInvitePayload extends RegisterRequest {
	token: string;
	enrollPersistentSession?: boolean;
}

export function registerAndAcceptInvite(
	payload: RegisterFromInvitePayload
): Promise<AcceptWorkspaceInviteResult> {
	return apiFetch('/v1/workspace-invites/register-and-accept', {
		method: 'POST',
		body: payload,
		skipAuth: true,
		headers: { 'X-Client': 'web' }
	});
}
