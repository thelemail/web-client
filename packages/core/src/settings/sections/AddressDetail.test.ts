import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { AccountAddress } from '$core/api/addresses';
import type { SharedAlias } from '$core/api/aliases';
import type { CustomDomain } from '$core/api/customDomains';
import type { Subscription } from '$core/api/billing';
import { addresses } from '$core/stores/addresses.svelte';
import { customDomains } from '$core/stores/customDomains.svelte';
import { billing } from '$core/stores/billing.svelte';
import AddressDetail from './AddressDetail.svelte';

const perm = vi.hoisted(() => ({ manage: true }));
vi.mock('$app/state', () => ({ page: { params: { slot: '0' } } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: 'me', fullName: 'Ada Lovelace', email: 'ada@thelemail.com' }
}));
vi.mock('../permissions', () => ({
	canManageWorkspace: () => perm.manage,
	isWorkspaceOwner: () => perm.manage
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));
vi.mock('$core/directory/lookup', () => ({ lookupDirectory: vi.fn() }));
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: vi.fn(),
	DirectoryVerificationError: class extends Error {}
}));
vi.mock('$core/settings/forwarding/authorize', () => ({ prepareForwarding: vi.fn() }));
vi.mock('$core/api/delegations', () => ({
	listSigningDelegations: vi.fn().mockResolvedValue({ delegations: [] })
}));
vi.mock('$core/api/readDelegations', () => ({
	listReadDelegations: vi.fn().mockResolvedValue({ readDelegations: [] })
}));

const at = '2026-09-21T12:00:00Z';

function acme(stage: 'pending' | 'owned' | 'ready'): CustomDomain {
	const owned = stage !== 'pending';
	const sending = stage === 'ready';
	return {
		id: 'd1',
		workspaceId: 'w1',
		domain: 'acme.co.uk',
		status: stage,
		addressCount: 1,
		ownershipVerifiedAt: owned ? at : null,
		dkimVerifiedAt: sending ? at : null,
		spfVerifiedAt: sending ? at : null,
		dmarcVerifiedAt: sending ? at : null,
		actionableStage: owned ? (sending ? null : 'sending') : 'ownership',
		createdAt: at,
		updatedAt: at
	};
}

function sales(over: Partial<AccountAddress> = {}): AccountAddress {
	return {
		id: 's',
		accountId: 'me',
		email: 'sales@acme.co.uk',
		localPart: 'sales',
		customDomainId: 'd1',
		isPrimary: false,
		createdAt: at,
		updatedAt: at,
		...over
	};
}

function setup(domain: CustomDomain, address: AccountAddress) {
	customDomains.items = [domain];
	addresses.items = [
		{
			id: 'p',
			accountId: 'me',
			email: 'ada@thelemail.com',
			localPart: 'ada',
			isPrimary: true,
			createdAt: at,
			updatedAt: at
		},
		address
	];
	return render(AddressDetail, { props: { addressId: address.id } });
}

function support(): SharedAlias {
	return {
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
}

function button(label: string): HTMLButtonElement | undefined {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

function text() {
	return document.body.textContent ?? '';
}

beforeEach(() => {
	perm.manage = true;
	billing.subscription = { planCode: 'business' } as Subscription;
});

afterEach(() => {
	cleanup();
	addresses.items = [];
	addresses.mySharedAliases = [];
	customDomains.clear();
	billing.subscription = null;
});

describe('AddressDetail', () => {
	it('explains a suspended address and links managers to the domain', () => {
		setup(acme('pending'), sales({ suspended: true }));
		expect(text()).toContain('This address is suspended.');
		expect(text()).toContain('It cannot send or receive mail until acme.co.uk is verified again.');
		expect(document.querySelector('a[href="/u/0/settings/domains/d1?step=ownership"]')).not.toBeNull();
	});

	it('hides the domain link from members', () => {
		perm.manage = false;
		setup(acme('pending'), sales({ suspended: true }));
		expect(text()).toContain('This address is suspended.');
		expect(document.querySelector('a[href^="/u/0/settings/domains/"]')).toBeNull();
	});

	it('will not make a suspended address primary', () => {
		setup(acme('pending'), sales({ suspended: true }));
		expect(button('Make primary')?.disabled).toBe(true);
	});

	it('switches off new signing and forwarding while suspended', async () => {
		setup(acme('pending'), sales({ suspended: true }));
		const note = 'New signing and forwarding can be set up once acme.co.uk is verified again.';
		expect([...document.querySelectorAll('.card-note')].map((n) => n.textContent?.trim())).toEqual([
			note,
			note
		]);
		expect(button('Authorize a service')?.disabled).toBe(true);
		expect(button('Forward to a system')?.disabled).toBe(true);
	});

	it('waits for sending records before new signing or forwarding', () => {
		setup(acme('owned'), sales());
		expect(text()).toContain(
			'Signing and forwarding can be set up once the sending records of acme.co.uk are verified.'
		);
		expect(button('Authorize a service')?.disabled).toBe(true);
	});

	it('keeps setup open for a live address', () => {
		setup(acme('ready'), sales());
		expect(document.querySelector('.card-note')).toBeNull();
		expect(button('Authorize a service')?.disabled).toBe(false);
		expect(button('Forward to a system')?.disabled).toBe(false);
	});

	it('lets a live address become primary', () => {
		setup(acme('ready'), sales());
		expect(text()).not.toContain('This address is suspended.');
		expect(button('Make primary')?.disabled).toBe(false);
	});

	it('shows a member the people on their shared address', () => {
		perm.manage = false;
		const alias = support();
		addresses.mySharedAliases = [alias];
		setup(
			acme('ready'),
			sales({ id: 'sup', email: alias.email, localPart: 'support', shared: true, sharedAliasId: alias.id })
		);
		const people = [...document.querySelectorAll('.ad-person-name')].map((n) => n.textContent?.trim());
		expect(people).toEqual(['Ada Lovelace you', 'Grace Hopper']);
		expect(text()).toContain('2 people');
		expect(text()).toContain('You are on this shared address.');
		expect(text()).not.toContain('belongs to');
		expect(text()).not.toContain('0 people');
		expect(button('Change people')).toBeUndefined();
	});

	it('leaves out the head count when the shared alias did not load', () => {
		perm.manage = false;
		setup(
			acme('ready'),
			sales({ id: 'sup', email: 'support@acme.co.uk', localPart: 'support', shared: true, sharedAliasId: 'sa1' })
		);
		expect(document.querySelector('.card-meta')).toBeNull();
		expect(document.querySelectorAll('.ad-person')).toHaveLength(0);
		expect(text()).toContain('You are on this shared address.');
		expect(text()).not.toContain('0 people');
	});
});
