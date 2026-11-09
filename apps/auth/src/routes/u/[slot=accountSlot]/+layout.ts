import { redirect } from '@sveltejs/kit';
import { auth } from '$core/stores/session.svelte';
import { accounts } from '$core/stores/accounts.svelte';
import { ensureProductKeys } from '$core/auth/product-keys';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent, params }) => {
	await parent();
	const slot = Number(params.slot);
	const record = accounts.bySlot(slot);
	if (!record) throw redirect(307, '/login');

	const accountId = record.accountId;
	auth.activate(accountId);

	if (!auth.isAuthenticated && !(await auth.tryRefresh(accountId))) {
		throw redirect(307, `/login?slot=${slot}`);
	}
	if (!auth.vaultUnlocked && !(await auth.ensureVaultUnlocked(accountId))) {
		throw redirect(307, `/login?slot=${slot}`);
	}
	await auth.loadProfile(accountId);
	void ensureProductKeys(accountId).catch((err) => console.warn('product keys: conversion failed', err));
	return { accountId, slot };
};
