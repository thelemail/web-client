import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import Account from './Account.svelte';
import { billing } from '$core/stores/billing.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import { ApiCallError } from '$core/api/types';
import type { Plan, Subscription } from '$core/api/billing';
import type { Workspace } from '$core/api/workspaces';
import { headingJumps, unnamedControls } from '../a11yAssert';

const api = vi.hoisted(() => ({
	createBillingPortalSession: vi.fn(),
	getMySubscription: vi.fn(),
	getPlans: vi.fn()
}));
const openExternal = vi.hoisted(() => vi.fn());

vi.mock('$platform', () => ({ platform: { returnOrigin: () => 'https://mail.test', openExternal } }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'me' } }));
vi.mock('$core/stores/accountData', () => ({ reloadWorkspaceData: vi.fn() }));
vi.mock('$core/api/billing', async (orig) => ({ ...(await orig<object>()), ...api }));

const at = '2026-10-01T12:00:00Z';

const personal: Plan = {
	code: 'personal',
	workspaceType: 'personal',
	displayName: 'Personal',
	pricingModel: 'flat',
	currency: 'usd',
	yearlyAmountCents: 3100,
	monthlyAmountCents: 325,
	minSeats: 1,
	maxSeats: 1,
	storageBytesPerMailbox: 15 * 1024 ** 3,
	customDomainsLimit: 1,
	auditRetentionDays: 30,
	prioritySupport: 'none'
};

let current: Subscription;

function subscribe(over: Partial<Subscription> = {}) {
	current = {
		status: 'active',
		entitled: true,
		planCode: 'personal',
		interval: 'year',
		cancelAtPeriodEnd: false,
		provider: 'stripe',
		...over
	};
	billing.subscription = current;
}

function button(label: string | RegExp) {
	return [...document.querySelectorAll('button')].find((b) => {
		const text = b.textContent?.trim() ?? '';
		return typeof label === 'string' ? text === label : label.test(text);
	});
}

beforeEach(() => {
	api.getMySubscription.mockImplementation(async () => current);
	api.getPlans.mockResolvedValue({ plans: [personal] });
	billing.catalog = { plans: [personal] };
	workspaces.workspace = { id: 'w1', ownerAccountId: 'me', name: 'Me', type: 'personal', createdAt: at, updatedAt: at } as Workspace;
	subscribe();
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	billing.subscription = null;
	billing.catalog = null;
	workspaces.workspace = null;
});

describe('Account plan actions', () => {
	it('shows no plan actions to an admin', () => {
		workspaces.workspace = { id: 'w1', ownerAccountId: 'boss', name: 'Acme', type: 'business', createdAt: at, updatedAt: at } as Workspace;
		render(Account, { props: { launch: vi.fn() } });
		expect(document.querySelector('.plan-acts button, .plan-acts a')).toBeNull();
	});

	it('shows plan actions to the owner', () => {
		render(Account, { props: { launch: vi.fn() } });
		expect(document.querySelector('.plan-acts button, .plan-acts a')).not.toBeNull();
	});
});

describe('Account billing management', () => {
	it('sends App Store subscribers to the App Store', async () => {
		subscribe({ provider: 'apple' });
		render(Account, { props: { launch: () => {} } });

		await fireEvent.click(button('Manage in App Store')!);

		expect(openExternal).toHaveBeenCalledWith('https://apps.apple.com/account/subscriptions');
		expect(api.createBillingPortalSession).not.toHaveBeenCalled();
	});

	it('sends Google Play subscribers to their Play subscription', async () => {
		subscribe({ provider: 'google_play' });
		render(Account, { props: { launch: () => {} } });

		await fireEvent.click(button('Manage in Google Play')!);

		expect(openExternal).toHaveBeenCalledWith(
			'https://play.google.com/store/account/subscriptions?sku=personal&package=com.thelemail.mail'
		);
		expect(api.createBillingPortalSession).not.toHaveBeenCalled();
	});

	it.each([['stripe' as const], [undefined]])('opens the web portal for provider %s', async (provider) => {
		subscribe({ provider });
		api.createBillingPortalSession.mockResolvedValue({ url: 'https://billing.stripe.test/s/1' });
		render(Account, { props: { launch: () => {} } });

		await fireEvent.click(button('Manage billing')!);

		await waitFor(() => expect(openExternal).toHaveBeenCalledWith('https://billing.stripe.test/s/1'));
		expect(api.createBillingPortalSession).toHaveBeenCalledOnce();
	});

	it.each([
		[409, 'This subscription is billed through an app store. Manage it there.'],
		[404, 'There is no subscription to manage yet.'],
		[500, 'Could not open billing portal']
	])('shows translated copy for a %i instead of the server text', async (status, copy) => {
		const raw = 'this subscription is managed in the App Store';
		api.createBillingPortalSession.mockRejectedValue(
			new ApiCallError(status, { error: { code: 'conflict', message: raw } }, raw)
		);
		render(Account, { props: { launch: () => {} } });

		await fireEvent.click(button('Manage billing')!);

		await waitFor(() => expect(document.body.textContent).toContain(copy));
		expect(document.body.textContent).not.toContain(raw);
	});
});

describe('Account plan price', () => {
	it('renders the catalog amount and currency', async () => {
		render(Account, { props: { launch: () => {} } });

		await waitFor(() => expect(document.querySelector('.plan-price')?.textContent).toContain('$31 / year'));
		expect(document.body.textContent).not.toContain('€24');
	});

	it('uses the monthly amount for a monthly subscription', async () => {
		subscribe({ interval: 'month' });
		render(Account, { props: { launch: () => {} } });

		await waitFor(() => expect(document.querySelector('.plan-price')?.textContent).toContain('$3.25 / month'));
	});

	it('shows no price without a catalog plan or an interval', async () => {
		api.getPlans.mockResolvedValue({ plans: [] });
		billing.catalog = { plans: [] };
		render(Account, { props: { launch: () => {} } });
		await waitFor(() => expect(api.getMySubscription).toHaveBeenCalled());
		expect(document.querySelector('.plan-price')?.textContent).not.toMatch(/[€$]/);
		cleanup();

		billing.catalog = { plans: [personal] };
		subscribe({ interval: undefined });
		render(Account, { props: { launch: () => {} } });
		await waitFor(() => expect(api.getMySubscription).toHaveBeenCalled());
		expect(document.querySelector('.plan-price')?.textContent).not.toMatch(/[€$]/);
	});

	it('names every control and keeps heading order under the page h1', async () => {
		const { container } = render(Account, { props: { launch: () => {} } });
		await waitFor(() => expect(document.querySelector('.plan-price')?.textContent).toContain('$31 / year'));

		expect(unnamedControls(container)).toEqual([]);
		expect(headingJumps(container, 1)).toEqual([]);
	});
});

describe('Account data export', () => {
	it('links Download your data to the Export Tool', () => {
		render(Account, { props: { launch: () => {} } });
		const link = [...document.querySelectorAll('a')].find((a) => a.textContent?.includes('Get the Export Tool'));
		expect(document.body.textContent).toContain('Download your data');
		expect(link?.getAttribute('href')).toBe('https://github.com/thelemail/export-tool');
	});
});
