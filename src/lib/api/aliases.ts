import { apiFetch } from './client';
import type { AccountAddress } from './addresses';

export interface SharedAliasMember {
	accountId: string;
	email: string;
	fullName: string;
	canSend: boolean;
	grantedKeyVersion: number;
}

export interface SharedAlias {
	id: string;
	workspaceId: string;
	addressId: string;
	customDomainId?: string | null;
	email: string;
	localPart: string;
	name: string;
	keyVersion: number;
	aliasPublicKeyArmored: string;
	keyAlgorithm: string;
	memberCount: number;
	rotationRequired: boolean;
	members: SharedAliasMember[];
	createdAt: string;
	updatedAt: string;
}

export interface AliasKeyGrant {
	aliasId: string;
	addressId: string;
	email: string;
	name: string;
	keyVersion: number;
	aliasKeyFingerprint: string;
	aliasPublicKeyArmored: string;
	wrappedPrivateKey: string;
	isCurrent: boolean;
}

export interface SharedAliasMemberGrant {
	accountId: string;
	memberKeyFingerprint: string;
	wrappedPrivateKey: string;
}

export interface CreateSharedAliasInput {
	customDomainId: string;
	localPart: string;
	name: string;
	aliasPublicKeyArmored: string;
	keyAlgorithm: string;
	members: SharedAliasMemberGrant[];
}

export interface RotateSharedAliasInput {
	aliasPublicKeyArmored: string;
	keyAlgorithm: string;
	members: SharedAliasMemberGrant[];
}

export interface CreateWorkspaceAliasInput {
	customDomainId: string;
	localPart: string;
	assigneeAccountId: string;
	name?: string;
}

export function listWorkspaceAliases(workspaceId: string): Promise<{ addresses: AccountAddress[] }> {
	return apiFetch(`/v1/workspaces/${workspaceId}/aliases`);
}

export function createWorkspaceAlias(
	workspaceId: string,
	input: CreateWorkspaceAliasInput
): Promise<AccountAddress> {
	return apiFetch(`/v1/workspaces/${workspaceId}/aliases`, { method: 'POST', body: input });
}

export function reassignWorkspaceAlias(
	workspaceId: string,
	addressId: string,
	assigneeAccountId: string
): Promise<AccountAddress> {
	return apiFetch(`/v1/workspaces/${workspaceId}/aliases/${addressId}`, {
		method: 'PATCH',
		body: { assigneeAccountId }
	});
}

export function deleteWorkspaceAlias(workspaceId: string, addressId: string): Promise<void> {
	return apiFetch(`/v1/workspaces/${workspaceId}/aliases/${addressId}`, { method: 'DELETE' });
}

export function listSharedAliases(workspaceId: string): Promise<{ sharedAliases: SharedAlias[] }> {
	return apiFetch(`/v1/workspaces/${workspaceId}/shared-aliases`);
}

export function createSharedAlias(
	workspaceId: string,
	input: CreateSharedAliasInput
): Promise<SharedAlias> {
	return apiFetch(`/v1/workspaces/${workspaceId}/shared-aliases`, { method: 'POST', body: input });
}

export function updateSharedAlias(
	workspaceId: string,
	aliasId: string,
	name: string
): Promise<SharedAlias> {
	return apiFetch(`/v1/workspaces/${workspaceId}/shared-aliases/${aliasId}`, {
		method: 'PATCH',
		body: { name }
	});
}

export function rotateSharedAliasMembers(
	workspaceId: string,
	aliasId: string,
	input: RotateSharedAliasInput
): Promise<SharedAlias> {
	return apiFetch(`/v1/workspaces/${workspaceId}/shared-aliases/${aliasId}/members`, {
		method: 'PUT',
		body: input
	});
}

export function deleteSharedAlias(workspaceId: string, aliasId: string): Promise<void> {
	return apiFetch(`/v1/workspaces/${workspaceId}/shared-aliases/${aliasId}`, { method: 'DELETE' });
}

export function listMySharedAliases(): Promise<{ sharedAliases: SharedAlias[] }> {
	return apiFetch('/v1/me/shared-aliases');
}

export function listMyAliasKeys(): Promise<{ keys: AliasKeyGrant[] }> {
	return apiFetch('/v1/me/alias-keys');
}
