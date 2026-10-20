import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import type { AccountAddress } from '$core/api/addresses';
import type { SharedAlias } from '$core/api/aliases';
import type { CustomDomain } from '$core/api/customDomains';
import type { Subscription } from '$core/api/billing';
import { addresses } from '$core/stores/addresses.svelte';
import { billing } from '$core/stores/billing.svelte';
import { customDomains } from '$core/stores/customDomains.svelte';
import { platformDomains } from '$core/stores/platformDomains.svelte';
import { workspaceAddresses } from '$core/stores/workspaceAddresses.svelte';
import Addresses from './Addresses.svelte';

vi.mock('$core/api/auth', async (importOriginal) => ({
	...(await importOriginal<typeof import('$core/api/auth')>()),
	getPlatformDomains: vi.fn().mockResolvedValue({
		domains: ['temail.org'],
		hosted: ['temail.org', 'thelemail.com'],
		default: 'temail.org'
	})
}));
vi.mock('$app/state', () => ({ page: { params: { slot: '0' } } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: 'me', fullName: 'Ada Lovelace', email: 'ada@thelemail.com' }
}));
const perms = vi.hoisted(() => ({ manage: false }));

vi.mock('../permissions', () => ({
	canManageWorkspace: () => perms.manage,
	isWorkspaceOwner: () => false
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));
vi.mock('$core/directory/lookup', () => ({ lookupDirectory: vi.fn() }));
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: vi.fn(),
	DirectoryVerificationError: class extends Error {}
}));
vi.mock('$core/api/delegations', () => ({
	listSigningDelegations: vi.fn().mockResolvedValue({ delegations: [] })
}));
vi.mock('$core/api/readDelegations', () => ({
	listReadDelegations: vi.fn().mockResolvedValue({ readDelegations: [] })
}));

const at = '2026-09-21T12:00:00Z';

beforeAll(() => platformDomains.load());

function address(id: string, email: string, over: Partial<AccountAddress> = {}): AccountAddress {
	return {
		id,
		accountId: 'me',
		email,
		localPart: email.split('@')[0],
		isPrimary: false,
		createdAt: at,
		updatedAt: at,
		...over
	};
}

const acme: CustomDomain = {
	id: 'd1',
	workspaceId: 'w1',
	domain: 'acme.co.uk',
	status: 'pending',
	addressCount: 1,
	actionableStage: 'ownership',
	createdAt: at,
	updatedAt: at
};

function rowOf(email: string): HTMLElement {
	const row = [...document.querySelectorAll<HTMLElement>('.addr-row')].find((r) =>
		r.textContent?.includes(email)
	);
	if (!row) throw new Error(`no row for ${email}`);
	return row;
}

async function menuOf(email: string): Promise<string> {
	const row = rowOf(email);
	await fireEvent.click(row.querySelector('.rowmenu')!);
	return row.querySelector('.addr-menu')?.textContent ?? '';
}

beforeEach(() => {
	customDomains.items = [acme];
	addresses.items = [
		address('p', 'ada@thelemail.com', { isPrimary: true }),
		address('h', 'hello@thelemail.com'),
		address('s', 'sales@acme.co.uk', { customDomainId: 'd1', suspended: true })
	];
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	addresses.items = [];
	addresses.mySharedAliases = [];
	customDomains.clear();
	billing.subscription = null;
	perms.manage = false;
});

describe('Addresses', () => {
	it('badges a suspended address and says why', () => {
		render(Addresses, { props: { launch: () => {} } });
		const suspended = rowOf('sales@acme.co.uk').textContent ?? '';
		expect(suspended).toContain('Suspended');
		expect(suspended).toContain('Cannot send or receive mail until acme.co.uk is verified again.');
		expect(rowOf('hello@thelemail.com').textContent).not.toContain('Suspended');
	});

	it('leaves make primary out of the menu for a suspended address', async () => {
		render(Addresses, { props: { launch: () => {} } });
		expect(await menuOf('sales@acme.co.uk')).not.toContain('Make primary');
		expect(await menuOf('hello@thelemail.com')).toContain('Make primary');
	});

	it('makes an address primary from the menu and refreshes both lists', async () => {
		const setPrimary = vi.spyOn(addresses, 'setPrimary').mockResolvedValue();
		const load = vi.spyOn(addresses, 'load').mockResolvedValue();
		const reload = vi.spyOn(workspaceAddresses, 'reload').mockResolvedValue();
		render(Addresses, { props: { launch: () => {} } });
		await menuOf('hello@thelemail.com');
		await fireEvent.click(screen.getByRole('button', { name: /make primary/i }));
		await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
		expect(setPrimary).toHaveBeenCalledWith('h');
		expect(load).toHaveBeenCalledOnce();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('shows a failed promotion next to the address', async () => {
		vi.spyOn(addresses, 'setPrimary').mockRejectedValue(new Error('boom'));
		render(Addresses, { props: { launch: () => {} } });
		await menuOf('hello@thelemail.com');
		await fireEvent.click(screen.getByRole('button', { name: /make primary/i }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toBe('Could not make this the primary address.');
		expect(alert.previousElementSibling).toBe(rowOf('hello@thelemail.com'));
	});

	it('never offers a shared address as primary', async () => {
		addresses.items = [
			...addresses.items,
			address('sh', 'team@thelemail.com', { shared: true })
		];
		render(Addresses, { props: { launch: () => {} } });
		expect(await menuOf('team@thelemail.com')).not.toContain('Make primary');
	});

	it('counts the people on a shared address the member is on', () => {
		const alias: SharedAlias = {
			id: 'sa1',
			workspaceId: 'w1',
			addressId: 'sup',
			customDomainId: 'd1',
			email: 'support@acme.co.uk',
			localPart: 'support',
			name: 'Support',
			keyVersion: 1,
			aliasPublicKeyArmored: '',
			keyAlgorithm: 'openpgp-ed25519',
			memberCount: 2,
			rotationRequired: false,
			members: [
				{ accountId: 'me', email: 'ada@acme.co.uk', fullName: 'Ada Lovelace', canSend: true, grantedKeyVersion: 1 },
				{ accountId: 'grace', email: 'grace@acme.co.uk', fullName: 'Grace Hopper', canSend: true, grantedKeyVersion: 1 }
			],
			createdAt: at,
			updatedAt: at
		};
		addresses.mySharedAliases = [alias];
		addresses.items = [
			...addresses.items,
			address('sup', alias.email, { customDomainId: 'd1', shared: true, sharedAliasId: alias.id })
		];
		render(Addresses, { props: { launch: () => {} } });
		const shared = rowOf('support@acme.co.uk');
		expect(shared.querySelector('.addr-used-tx')?.textContent).toBe('You and 1 other');
		expect(shared.querySelectorAll('.avstack > *')).toHaveLength(2);
	});

	it('tells a free family manager only about the shared alias', () => {
		perms.manage = true;
		billing.subscription = { planCode: 'free_family' } as Subscription;
		customDomains.items = [];
		addresses.items = [address('p', 'ada@thelemail.com', { isPrimary: true })];
		render(Addresses, { props: { launch: () => {} } });
		const note = document.querySelector('.addr-plan')?.textContent ?? '';
		expect(note).toContain('one shared alias');
		expect(note).not.toContain('domain you own');
		expect(document.querySelector('.addr-intro-act')?.textContent).toContain('Add an alias');
	});

	it('leaves the upgrade nudge as the only plan message on free', () => {
		perms.manage = true;
		billing.subscription = { planCode: 'free' } as Subscription;
		render(Addresses, { props: { launch: () => {} } });
		expect(document.querySelector('.addr-plan')).toBeNull();
		expect(document.querySelector('.upgrade-list')?.textContent).toContain(
			'More addresses come with a paid plan'
		);
	});

	it('counts a legacy shared alias against the slot and names its domain', () => {
		perms.manage = true;
		billing.subscription = { planCode: 'free_family' } as Subscription;
		customDomains.items = [];
		addresses.items = [
			address('p', 'ada@thelemail.com', { isPrimary: true }),
			address('fam', 'family@thelemail.com', { shared: true })
		];
		render(Addresses, { props: { launch: () => {} } });
		const note = document.querySelector('.addr-plan')?.textContent ?? '';
		expect(note).toContain('one shared alias on thelemail.com, and it is in use');
		expect(note).not.toContain('temail.org');
		expect(document.querySelector('.upgrade-list')?.textContent).toContain(
			'One shared address on thelemail.com'
		);
	});
});
