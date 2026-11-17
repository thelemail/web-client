import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

const nav = vi.hoisted(() => ({ goto: vi.fn(async () => undefined) }));
vi.mock('$app/navigation', () => nav);

const session = vi.hoisted(() => ({
	auth: {
		accountId: 'acct-active' as string | null,
		activate: vi.fn(),
		tryRefresh: vi.fn(async () => true),
		ensureVaultUnlocked: vi.fn(async () => true)
	}
}));
vi.mock('$core/stores/session.svelte', () => session);

const known = vi.hoisted(() => ({
	list: [] as { accountId: string; slot: number }[],
	byId: vi.fn((id: string) => ({ 'acct-active': { accountId: 'acct-active', slot: 0 }, 'acct-named': { accountId: 'acct-named', slot: 1 } })[id] ?? null)
}));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: known }));

const flow = vi.hoisted(() => ({
	expected: null as string | null,
	takeAuthorizeFragment: vi.fn(() => '#request=x'),
	locateRequest: vi.fn(async () => ({ descriptor: { expectedAccountId: flow.expected } })),
	grantRequest: vi.fn(async () => 'http://app.test/auth/callback#code'),
	clearPendingAuthorize: vi.fn()
}));
vi.mock('$core/producthandoff/authorize', () => flow);
vi.mock('$core/auth/product-keys', () => ({ ensureConverted: vi.fn(async () => true) }));
vi.mock('$core/keys/uid-sync', () => ({ syncAddressUids: vi.fn(async () => undefined) }));

import Page from './+page.svelte';

const replace = vi.fn();

beforeEach(() => {
	sessionStorage.clear();
	flow.expected = null;
	session.auth.accountId = 'acct-active';
	for (const fn of [nav.goto, flow.grantRequest, flow.clearPendingAuthorize, session.auth.activate, replace]) fn.mockClear();
	Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, replace } });
});

afterEach(() => cleanup());

describe('authorize without a named account', () => {
	it('asks the person to sign in before granting anything', async () => {
		render(Page);
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/login'));
		expect(flow.grantRequest).not.toHaveBeenCalled();
	});

	it('grants the account that was just signed in', async () => {
		sessionStorage.setItem('thelemail-authorize-login', '1');
		render(Page);
		await vi.waitFor(() => expect(flow.grantRequest).toHaveBeenCalledWith('acct-active', expect.anything()));
		expect(replace).toHaveBeenCalledWith('http://app.test/auth/callback#code');
	});
});

describe('authorize for a named account', () => {
	it('grants the named account without a new sign-in', async () => {
		flow.expected = 'acct-named';
		render(Page);
		await vi.waitFor(() => expect(flow.grantRequest).toHaveBeenCalledWith('acct-named', expect.anything()));
		expect(nav.goto).not.toHaveBeenCalled();
	});
});
