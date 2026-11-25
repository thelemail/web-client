import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';

const nav = vi.hoisted(() => ({ goto: vi.fn(async () => undefined) }));
vi.mock('$app/navigation', () => nav);

const session = vi.hoisted(() => ({
	auth: {
		accountId: 'acct-active' as string | null,
		activate: vi.fn(),
		tryRefresh: vi.fn(async () => true),
		ensureVaultUnlocked: vi.fn(async () => true),
		vaultUnlockedFor: vi.fn(() => true),
		sessionLost: vi.fn(() => false),
		loadProfile: vi.fn(async () => undefined),
		deletionFor: vi.fn((): { purgeAt: string } | null => null)
	}
}));
vi.mock('$core/stores/session.svelte', () => session);

const ACTIVE = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const OTHER = '8e1f4c2a-7b3d-4a5e-b6c9-0d2e3f4a5b6c';

const known = vi.hoisted(() => ({
	list: [] as { accountId: string; slot: number }[],
	byId: vi.fn((id: string) => ({ 'acct-active': { accountId: 'acct-active', slot: 0 }, 'acct-named': { accountId: 'acct-named', slot: 1 } })[id] ?? null)
}));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: known }));

const flow = vi.hoisted(() => ({
	expected: null as string | null,
	takeAuthorizeFragment: vi.fn(() => '#request=x'),
	hint: null as string | null,
	authorizeHint: vi.fn(() => flow.hint),
	intent: null as 'register' | null,
	authorizeIntent: vi.fn(() => flow.intent),
	registerQuery: '',
	authorizeRegisterQuery: vi.fn(() => flow.registerQuery),
	route: null as string | null,
	authorizeRoute: vi.fn(() => flow.route),
	locateRequest: vi.fn(async () => ({ requestId: 'req-1', descriptor: { expectedAccountId: flow.expected } })),
	grantRequest: vi.fn(async () => 'http://app.test/auth/callback#code=c'),
	clearPendingAuthorize: vi.fn(),
	markLoginTried: vi.fn((id: string) => sessionStorage.setItem('tried', id)),
	loginTried: vi.fn((id: string) => sessionStorage.getItem('tried') === id)
}));
vi.mock('$core/producthandoff/authorize', () => flow);
vi.mock('$core/auth/product-keys', () => ({ ensureConverted: vi.fn(async () => true) }));
vi.mock('$core/keys/uid-sync', () => ({ syncAddressUids: vi.fn(async () => undefined) }));

import Page from './+page.svelte';

const replace = vi.fn();

beforeEach(() => {
	sessionStorage.clear();
	known.list = [];
	flow.expected = null;
	flow.intent = null;
	flow.registerQuery = '';
	flow.route = null;
	flow.hint = null;
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

	it('fills in the address the product asked for', async () => {
		flow.expected = 'acct-unknown';
		flow.hint = 'nora@thelemail.test';
		render(Page);
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/login?hint=nora%40thelemail.test'));
		expect(flow.grantRequest).not.toHaveBeenCalled();
	});

	it('grants the account that was just signed in and hands back its index', async () => {
		sessionStorage.setItem('tried', 'req-1');
		known.list = [
			{ accountId: ACTIVE, slot: 0 },
			{ accountId: OTHER, slot: 1 }
		];
		render(Page);
		await vi.waitFor(() => expect(flow.grantRequest).toHaveBeenCalledWith('acct-active', expect.anything()));
		const p = new URLSearchParams(new URL(replace.mock.calls[0][0] as string).hash.slice(1));
		expect(p.get('code')).toBe('c');
		expect(p.get('slot')).toBe('0');
		expect(p.get('slots')).toBe(`${ACTIVE}.0,${OTHER}.1`);
	});

	it('sends the person to sign in when the earlier sign-in was for another request', async () => {
		sessionStorage.setItem('tried', 'req-old');
		render(Page);
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/login'));
		expect(flow.grantRequest).not.toHaveBeenCalled();
		expect(sessionStorage.getItem('tried')).toBe('req-1');
	});

	it('opens registration when the product asked for a new account', async () => {
		flow.intent = 'register';
		flow.registerQuery = '?plan=family&billing=monthly';
		render(Page);
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/register?plan=family&billing=monthly'));
	});

	it('hands back where checkout continues after a paid registration', async () => {
		sessionStorage.setItem('tried', 'req-1');
		flow.route = '/u/0/billing/start?plan=family&interval=month&type=family';
		render(Page);
		await vi.waitFor(() => expect(replace).toHaveBeenCalled());
		const p = new URLSearchParams(new URL(replace.mock.calls[0][0] as string).hash.slice(1));
		expect(p.get('route')).toBe('/u/0/billing/start?plan=family&interval=month&type=family');
	});

	it('stops instead of looping when sign-in for this request already happened', async () => {
		sessionStorage.setItem('tried', 'req-1');
		session.auth.tryRefresh.mockResolvedValueOnce(false);
		render(Page);
		await vi.waitFor(() => expect(flow.clearPendingAuthorize).toHaveBeenCalled());
		expect(nav.goto).not.toHaveBeenCalled();
		expect(flow.grantRequest).not.toHaveBeenCalled();
	});
});

describe('authorize for an account pending deletion', () => {
	it('shows the cancel screen on the account origin instead of granting', async () => {
		flow.expected = 'acct-named';
		session.auth.deletionFor.mockReturnValueOnce({ purgeAt: '2026-12-02T00:00:00Z' });
		render(Page);
		await vi.waitFor(() => expect(nav.goto).toHaveBeenCalledWith('/u/1/deletion-pending'));
		expect(flow.grantRequest).not.toHaveBeenCalled();
		expect(flow.clearPendingAuthorize).not.toHaveBeenCalled();
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
