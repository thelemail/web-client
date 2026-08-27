import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/stores/auth.svelte';
import { accounts } from '$lib/stores/accounts.svelte';
import { keystore } from '$lib/keystore/keystore-client';
import { billing } from '$lib/stores/billing.svelte';
import { lifecycle } from '$lib/lifecycle/lifecycle.svelte';
import type { LayoutLoad } from './$types';

export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = async ({ parent, params, url }) => {
	await parent();
	const slot = Number(params.slot);
	const record = accounts.bySlot(slot);
	if (!record) {
		throw redirect(303, `/login?addAccount=1&redirect=${encodeURIComponent(url.pathname)}`);
	}
	const accountId = record.accountId;

	auth.activate(accountId);

	if (!auth.vaultUnlocked) {
		const unlocked = await auth.ensureVaultUnlocked(accountId);
		if (!unlocked) {
			const status = await keystore.status();
			const known = status.accounts.some((a) => a.accountId === accountId);
			if (!known) {
				await accounts.remove(accountId);
				throw redirect(303, `/login?addAccount=1&redirect=${encodeURIComponent(url.pathname)}`);
			}
			throw redirect(303, `/login?slot=${slot}&redirect=${encodeURIComponent(url.pathname + url.search)}`);
		}
	}
	if (!auth.isAuthenticated) {
		const refreshed = await auth.tryRefresh(accountId);
		if (!refreshed) {
			throw redirect(303, `/login?slot=${slot}&redirect=${encodeURIComponent(url.pathname + url.search)}`);
		}
	}
	if (auth.fullName === null) {
		await auth.loadProfile(accountId);
	}
	const pendingPath = `/u/${slot}/deletion-pending`;
	const deletion = auth.deletionFor(accountId);
	if (deletion && url.pathname !== pendingPath) {
		throw redirect(303, pendingPath);
	}
	if (!deletion && url.pathname === pendingPath) {
		throw redirect(303, `/u/${slot}/mail/inbox`);
	}
	if (deletion) {
		return { accountId, slot };
	}
	const sub = await billing.ensureLoaded();
	const inBilling = url.pathname.startsWith(`/u/${slot}/billing`);
	const escapable = inBilling || url.pathname.startsWith(`/u/${slot}/lifecycle`);

	lifecycle.setAccount(accountId);
	const stage = lifecycle.stage;

	if (stage === 'suspended' && !escapable) {
		throw redirect(303, `/u/${slot}/lifecycle/suspended`);
	}
	if (stage === 'expired' && !escapable) {
		throw redirect(303, `/u/${slot}/lifecycle/expired`);
	}
	if (
		url.pathname.startsWith(`/u/${slot}/lifecycle/restore`) &&
		sub?.entitled &&
		stage === 'active'
	) {
		throw redirect(303, `/u/${slot}/mail/inbox`);
	}
	if (sub && !sub.entitled && stage === 'active' && !inBilling) {
		throw redirect(303, `/u/${slot}/billing/choose`);
	}

	return { accountId, slot };
};
