import { consumeSessionFork, produceSessionFork } from './api/forks';
import { keystore } from './keystore/keystore-client';
import type { AliasKeyGrantInput } from './keystore/protocol';
import { currentProduct, productTarget } from './products';

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
	if (!target) throw new ForkError('unknown_product', 'That product is not configured.');

	const sealed = await keystore.sealProductFork({ accountId, product: audience, grants });
	if (!sealed.ok) {
		throw new ForkError(
			sealed.code,
			sealed.code === 'locked'
				? 'Vault is locked; sign in again.'
				: 'There are no keys to hand over yet.'
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
	if (!selector || !key) throw new ForkError('missing_fragment', 'This link is incomplete.');

	const res = await consumeSessionFork(selector);
	if (res.audience !== currentProduct) {
		throw new ForkError('wrong_product', 'This link was issued for a different product.');
	}
	const opened = await keystore.openProductFork({
		product: currentProduct,
		payload: res.payload,
		key
	});
	if (!opened.ok) throw new ForkError(opened.code, 'This link could not be opened.');

	return {
		accountId: opened.accountId,
		email: opened.email,
		keyCount: opened.keyCount,
		redirect: safeRedirect(params.get('redirect'))
	};
}

function safeRedirect(value: string | null): string {
	if (!value) return '/';
	if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
	return value;
}
