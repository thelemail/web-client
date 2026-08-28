import { auth } from '$lib/stores/auth.svelte';
import { accounts } from '$lib/stores/accounts.svelte';
import { keystore } from '$lib/keystore/keystore-client';

export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';

let bootstrapped = false;

export const load = async () => {
	if (bootstrapped) return {};
	bootstrapped = true;
	await auth.hydrate();

	const status = await keystore.status();
	for (const a of status.accounts) {
		if (accounts.byId(a.accountId)) continue;
		const now = Date.now();
		await accounts.upsert({
			accountId: a.accountId,
			slot: accounts.allocateSlot(),
			email: a.email,
			addedAt: now,
			lastActiveAt: now
		});
	}

	for (const a of status.accounts) {
		if (a.hasPersistent && !a.unlocked) {
			await auth.ensureVaultUnlocked(a.accountId);
		}
	}

	auth.adoptPreferredAccount();

	if (auth.vaultUnlocked && !auth.isAuthenticated) {
		await auth.tryRefresh();
	}
	return {};
};
