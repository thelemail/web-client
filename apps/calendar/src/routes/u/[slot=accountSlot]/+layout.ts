import { auth } from '$core/stores/auth.svelte';
import { accounts } from '$core/stores/accounts.svelte';
import { handOffToApp } from '$core/products';
import type { LayoutLoad } from './$types';

export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = async ({ parent, params }) => {
	await parent();
	const slot = Number(params.slot);
	const record = accounts.bySlot(slot);
	if (!record) return handOffToApp();

	const accountId = record.accountId;
	auth.activate(accountId);

	if (!auth.vaultUnlocked && !(await auth.ensureVaultUnlocked(accountId))) {
		return handOffToApp();
	}
	if (!auth.isAuthenticated && !(await auth.tryRefresh(accountId))) {
		return handOffToApp();
	}
	return { accountId, slot };
};
