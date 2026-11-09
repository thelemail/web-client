import { auth } from '$core/stores/auth.svelte';
import { accounts } from '$core/stores/accounts.svelte';
import { handOffToApp } from '$core/products';
import { reopen } from '$core/producthandoff/fallback';
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
		return reopen(record, `/u/${slot}/calendar`);
	}
	if (!auth.isAuthenticated && !(await auth.tryRefresh(accountId))) {
		return reopen(record, `/u/${slot}/calendar`);
	}
	return { accountId, slot };
};
