import { redirect } from '@sveltejs/kit';
import { accounts } from '$lib/stores/accounts.svelte';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	await parent();
	const known = accounts.list;
	if (known.length === 0) {
		throw redirect(307, '/login');
	}
	if (known.length === 1) {
		throw redirect(307, `/u/${known[0].slot}/mail/inbox`);
	}
	return {};
};
