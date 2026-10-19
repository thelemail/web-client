import type { AccountAddress } from '$core/api/addresses';
import type { SharedAlias } from '$core/api/aliases';
import { addresses } from '$core/stores/addresses.svelte';
import { aliases } from '$core/stores/aliases.svelte';
import { workspaceAddresses } from '$core/stores/workspaceAddresses.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import { customDomains } from '$core/stores/customDomains.svelte';
import { delegations } from '$core/stores/delegations.svelte';
import { readDelegations } from '$core/stores/readDelegations.svelte';
import { platformDomains } from '$core/stores/platformDomains.svelte';
import { auth } from '$core/stores/auth.svelte';
import { dedupeAddresses, type ModelContext } from './addressModel';

function visibleSharedAliases(manage: boolean): SharedAlias[] {
	const workspace = manage ? aliases.items : [];
	const known = new Set(workspace.map((a) => a.id));
	return [...workspace, ...addresses.mySharedAliases.filter((a) => !known.has(a.id))];
}

export function addressContext(manage: boolean): ModelContext {
	return {
		accountId: auth.accountId,
		manage,
		members: workspaces.members,
		domains: customDomains.items,
		platformDomains: platformDomains.hosted,
		sharedAliases: visibleSharedAliases(manage),
		fullName: auth.fullName,
		delegationsFor: (id) => delegations.for(id),
		forwardingFor: (id) => readDelegations.for(id)
	};
}

export function addressSource(manage: boolean): AccountAddress[] {
	return manage
		? dedupeAddresses([addresses.items, workspaceAddresses.items])
		: dedupeAddresses([addresses.items]);
}
