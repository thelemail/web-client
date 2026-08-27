import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/stores/auth.svelte';
import { accounts } from '$lib/stores/accounts.svelte';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	await parent();
	if (auth.canEnterApp) {
		const slot = accounts.lastActiveSlot;
		if (slot !== null) {
			throw redirect(307, `/u/${slot}/mail/inbox`);
		}
	}
	throw redirect(307, '/login');
};
