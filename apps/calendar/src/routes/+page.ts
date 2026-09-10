import { redirect } from '@sveltejs/kit';
import { auth } from '$core/stores/auth.svelte';
import { accounts } from '$core/stores/accounts.svelte';
import { handOffToApp } from '$core/products';

export const load = async () => {
	for (const record of accounts.list) {
		auth.activate(record.accountId);
		if (!auth.vaultUnlocked && !(await auth.ensureVaultUnlocked(record.accountId))) continue;
		if (!auth.isAuthenticated && !(await auth.tryRefresh(record.accountId))) continue;
		throw redirect(303, `/u/${record.slot}/calendar`);
	}
	return handOffToApp();
};
