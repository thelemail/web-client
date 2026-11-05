import { redirect } from '@sveltejs/kit';
import { auth } from '$core/stores/session.svelte';
import { accounts } from '$core/stores/accounts.svelte';

export const load = async ({ parent }) => {
	await parent();
	const ranked = [...accounts.list].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
	const ready = ranked.find((r) => auth.vaultUnlockedFor(r.accountId) && !auth.sessionLost(r.accountId));
	if (ready) throw redirect(307, `/u/${ready.slot}`);
	if (ranked[0]) throw redirect(307, `/login?slot=${ranked[0].slot}`);
	throw redirect(307, '/login');
};
