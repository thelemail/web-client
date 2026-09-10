import { auth } from '$core/stores/auth.svelte';
import { accounts } from '$core/stores/accounts.svelte';
import { boot } from '$core/stores/boot.svelte';
import { keystore } from '$core/keystore/keystore-client';

export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';

let bootstrapped = false;

export const load = async () => {
	if (bootstrapped) return {};
	try {
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
		auth.adoptPreferredAccount();
		for (const a of status.accounts) {
			if (a.hasPersistent && !a.unlocked) await auth.ensureVaultUnlocked(a.accountId);
		}
		auth.adoptPreferredAccount();
		if (auth.vaultUnlocked && !auth.isAuthenticated) await auth.tryRefresh();
		bootstrapped = true;
	} catch (err) {
		console.warn('bootstrap: local account state unavailable', err);
		boot.markStorageUnavailable();
	}
	return {};
};
