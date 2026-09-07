import { auth } from '$lib/stores/auth.svelte';
import { accounts } from '$lib/stores/accounts.svelte';
import { boot } from '$lib/stores/boot.svelte';
import { keystore } from '$lib/keystore/keystore-client';
import { platform } from '$platform';

export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';

const MAX_ATTEMPTS = 2;

let bootstrapped = false;
let attempts = 0;

async function bootstrap() {
	await auth.hydrate();

	if (platform.session) {
		for (const record of accounts.list) {
			try {
				await platform.session.restore(record.accountId);
			} catch (err) {
				console.warn('session: could not restore', err);
			}
		}
	}

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
}

export const load = async () => {
	if (bootstrapped || attempts >= MAX_ATTEMPTS) return {};
	attempts++;
	try {
		await bootstrap();
		bootstrapped = true;
	} catch (err) {
		console.warn('bootstrap: local account state unavailable', err);
		boot.markStorageUnavailable();
	}
	return {};
};
