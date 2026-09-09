import { redirect } from '@sveltejs/kit';
import { accounts } from '$core/stores/accounts.svelte';
import { appOrigin } from '$core/products';

export const load = async () => {
	const first = accounts.list[0];
	if (!first) {
		if (typeof window !== 'undefined') window.location.assign(appOrigin());
		return {};
	}
	throw redirect(303, `/u/${first.slot}/calendar`);
};
