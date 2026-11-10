import { loginIdentifier } from '$core/auth/login-identifier';
import { keystore } from '$core/keystore/keystore-client';
import { safeRoute, startHandoff } from '$core/producthandoff/begin';
import { accounts } from '$core/stores/accounts.svelte';

function sameAddress(a: string, b: string): boolean {
	return loginIdentifier(a).toLowerCase() === loginIdentifier(b).toLowerCase();
}

export async function mailOnlyAccountId(target: { slot?: number | null; identifier?: string }): Promise<string | null> {
	await accounts.load();
	const record =
		typeof target.slot === 'number' && !Number.isNaN(target.slot)
			? accounts.bySlot(target.slot)
			: target.identifier
				? (accounts.list.find((r) => sameAddress(r.email, target.identifier ?? '')) ?? null)
				: null;
	if (!record) return null;
	const status = await keystore.status();
	return status.accounts.some((a) => a.accountId === record.accountId && a.mailOnly) ? record.accountId : null;
}

export async function unlockAtAuth(accountId: string, redirect: string | null): Promise<never> {
	const status = await keystore.status();
	const remember = status.accounts.find((a) => a.accountId === accountId)?.hasPersistent ?? false;
	await startHandoff({ expectedAccountId: accountId, route: safeRoute(redirect), remember });
	return new Promise<never>(() => {});
}
