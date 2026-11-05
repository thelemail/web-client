import { auth } from '$core/stores/session.svelte';
import { accounts } from '$core/stores/accounts.svelte';
import { boot } from '$core/stores/boot.svelte';
import { keystore } from '$core/keystore/keystore-client';
import { initLocale } from '$core/i18n/locale.svelte';

export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';

let bootstrapped = false;
let localeReady: Promise<void> | null = null;

async function bootstrap() {
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
	for (const record of accounts.list) {
		if (!(await auth.tryRefresh(record.accountId))) continue;
		const entry = status.accounts.find((a) => a.accountId === record.accountId);
		if (entry?.hasPersistent && !entry.unlocked) {
			await auth.ensureVaultUnlocked(record.accountId);
		}
	}
	auth.adoptPreferredAccount();
}

export const load = async () => {
	await (localeReady ??= initLocale());
	if (bootstrapped) return {};
	try {
		await bootstrap();
		bootstrapped = true;
	} catch (err) {
		console.warn('bootstrap: local account state unavailable', err);
		boot.markStorageUnavailable();
	}
	return {};
};
