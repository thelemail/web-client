import { redirect } from '@sveltejs/kit';
import { accounts } from '$lib/stores/accounts.svelte';
import { resolveReturnTo } from '$lib/auth/return-to';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, url }) => {
	await parent();
	const known = accounts.list;
	const back = url.searchParams.get('redirect');
	if (known.length === 0) {
		throw redirect(307, back ? `/login?redirect=${encodeURIComponent(back)}` : '/login');
	}
	if (known.length === 1) {
		throw redirect(307, resolveReturnTo(back, known[0].slot));
	}
	return {};
};
