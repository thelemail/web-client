import { consumeSessionFork, produceSessionFork } from './api/forks';
import { keystore } from './keystore/keystore-client';
import { auth } from './stores/auth.svelte';
import type { AliasKeyGrantInput } from './keystore/protocol';
import { currentProduct, productTarget } from './products';
import { m } from '$paraglide/messages.js';

export class ForkError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

export async function handoffUrl(
	accountId: string,
	audience: string,
	grants: AliasKeyGrantInput[],
	path: string
): Promise<string> {
	const target = productTarget(audience);
	if (!target) throw new ForkError('unknown_product', m.product_fork_not_configured());

	const sealed = await keystore.sealProductFork({ accountId, product: audience, grants });
	if (!sealed.ok) {
		throw new ForkError(
			sealed.code,
			sealed.code === 'locked'
				? m.product_fork_vault_locked()
				: m.product_fork_no_keys()
		);
	}
	const res = await produceSessionFork(accountId, audience, sealed.payload);
	const fragment = new URLSearchParams({
		selector: res.selector,
		key: sealed.key,
		redirect: path
	});
	return `${target.origin}/fork#${fragment.toString()}`;
}

export interface AdoptedFork {
	accountId: string;
	email: string;
	keyCount: number;
	redirect: string;
}

export async function adoptFork(fragment: string): Promise<AdoptedFork> {
	const params = new URLSearchParams(fragment.replace(/^#/, ''));
	const selector = params.get('selector');
	const key = params.get('key');
	if (!selector || !key) throw new ForkError('missing_fragment', m.product_fork_link_incomplete());

	const res = await consumeSessionFork(selector);
	if (res.audience !== currentProduct) {
		throw new ForkError('wrong_product', m.product_fork_wrong_product());
	}
	if (!(await auth.tryRefresh(res.accountId))) {
		throw new ForkError(
			'no_session',
			m.product_fork_no_session()
		);
	}
	const opened = await keystore.openProductFork({
		product: currentProduct,
		accountId: res.accountId,
		payload: res.payload,
		key
	});
	if (!opened.ok) throw new ForkError(opened.code, m.product_fork_open_failed());

	return {
		accountId: opened.accountId,
		email: opened.email,
		keyCount: opened.keyCount,
		redirect: safeRedirect(params.get('redirect'))
	};
}

export function localForkPath(redirect: string, slot: number): string {
	const rest = redirect.replace(/^\/u\/\d+(?=\/|$)/, '');
	return `/u/${slot}${rest === '' || rest === '/' ? '/calendar' : rest}`;
}

function safeRedirect(value: string | null): string {
	if (!value) return '/';
	if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
	return value;
}
