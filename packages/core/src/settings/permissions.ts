import { auth } from '$core/stores/auth.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';

export function canManageWorkspace(): boolean {
	return workspaces.canManage(auth.accountId);
}

export function isWorkspaceOwner(): boolean {
	return workspaces.isOwner(auth.accountId);
}
