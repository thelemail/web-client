import { redirect } from '@sveltejs/kit';
import { auth } from '$core/stores/auth.svelte';
import { accounts } from '$core/stores/accounts.svelte';
import type { LayoutLoad } from './$types';

export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = async ({ parent, params }) => {
	await parent();
	const slot = Number(params.slot);
	const record = accounts.bySlot(slot);
	if (!record) throw redirect(303, '/');

	const accountId = record.accountId;
	auth.activate(accountId);

	if (!auth.vaultUnlocked) throw redirect(303, '/');
	if (!auth.isAuthenticated) {
		const refreshed = await auth.tryRefresh(accountId);
		if (!refreshed) throw redirect(303, '/');
	}
	return { accountId, slot };
};
