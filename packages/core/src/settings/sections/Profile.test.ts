import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import type { AccountAddress } from '$core/api/addresses';
import type { CustomDomain, CustomDomainStatus } from '$core/api/customDomains';
import type { WorkspaceMemberRole, WorkspaceType } from '$core/api/workspaces';
import { addresses } from '$core/stores/addresses.svelte';
import { customDomains } from '$core/stores/customDomains.svelte';
import { workspaces } from '$core/stores/workspaces.svelte';
import { m } from '$paraglide/messages.js';
import Profile from './Profile.svelte';

vi.mock('$app/state', () => ({ page: { params: { slot: '0' } } }));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: {
		accountId: 'me',
		fullName: 'Ada Lovelace',
		email: 'ada@thelemail.com',
		avatarUrl: null,
		defaultReplyAddressId: null
	}
}));
vi.mock('$core/api/me', () => ({
	updateMe: vi.fn(),
	requestAvatarUploadUrl: vi.fn(),
	commitAvatar: vi.fn(),
	deleteAvatar: vi.fn()
}));
vi.mock('$core/mail/send', () => ({ sha256B64: vi.fn() }));
vi.mock('$core/mail/signatureImages', () => ({ hostSignatureImages: vi.fn() }));
vi.mock('$core/stores/signatures.svelte', () => ({
	signatures: { locked: false, getForAddress: () => null, save: vi.fn(), remove: vi.fn() }
}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: {} }));

const at = '2026-10-19T12:00:00Z';

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

function domain(status: CustomDomainStatus, over: Partial<CustomDomain> = {}): CustomDomain {
	return {
		id: 'd1',
		workspaceId: 'w1',
		domain: 'acme.test',
		status,
		addressCount: 1,
		actionableStage: 'ownership',
		createdAt: at,
		updatedAt: at,
		...over
	};
}

function setWorkspace(type: WorkspaceType, role: WorkspaceMemberRole | null) {
	workspaces.workspace = {
		id: 'w1',
		ownerAccountId: role === 'owner' ? 'me' : 'boss',
		name: 'Home',
		type,
		createdAt: at,
		updatedAt: at
	};
	workspaces.members = role
		? [
				{
					workspaceId: 'w1',
					accountId: 'me',
					email: 'ada@thelemail.com',
					fullName: 'Ada Lovelace',
					role,
					joinedAt: at
				}
			]
		: [];
}

function renderProfile(email = 'ada@thelemail.com') {
	return render(Profile, { email });
}

const verifiedPattern = /verified domain/i;

beforeEach(() => {
	workspaces.setAccount('me');
});

afterEach(() => {
	cleanup();
	addresses.items = [];
	customDomains.clear();
	workspaces.setAccount(null);
});

describe('profile header', () => {
	it('shows neither a domain indicator nor a role for a platform-address account', () => {
		addresses.items = [address('p', 'ada@thelemail.com', { isPrimary: true })];
		setWorkspace('personal', 'owner');
		const { container } = renderProfile();
		expect(container.textContent).not.toMatch(verifiedPattern);
		expect(container.textContent).not.toMatch(/your domain/i);
		expect(container.querySelector('.pf-tags')).toBeNull();
	});

	const unverified: [string, CustomDomain][] = [
		['pending', domain('pending')],
		['owned', domain('owned', { ownershipVerifiedAt: at })],
		['ready', domain('ready', { ownershipVerifiedAt: at, dkimVerifiedAt: at, spfVerifiedAt: at, dmarcVerifiedAt: at })],
		['failed', domain('failed', { ownershipVerifiedAt: at })],
		[
			'active with lapsing ownership',
			domain('active', {
				ownershipVerifiedAt: at,
				dkimVerifiedAt: at,
				spfVerifiedAt: at,
				dmarcVerifiedAt: at,
				mxVerifiedAt: at,
				ownershipMissingSince: at
			})
		]
	];

	it.each(unverified)('claims no verified domain when the domain is %s', (_, d) => {
		customDomains.items = [d];
		addresses.items = [address('a', 'ada@acme.test', { isPrimary: true, customDomainId: 'd1' })];
		setWorkspace('personal', 'owner');
		const { container } = renderProfile('ada@acme.test');
		expect(container.textContent).not.toMatch(verifiedPattern);
		expect(container.querySelector('.profile .b-ok')).toBeNull();
	});

	it('shows no role to the owner of a personal workspace', () => {
		setWorkspace('personal', 'owner');
		const { container } = renderProfile();
		expect(container.querySelector('.pf-tags')).toBeNull();
		expect(container.querySelector('.profile')?.textContent).not.toContain(m.settings_member_role_owner());
	});

	const shared: [WorkspaceType, WorkspaceMemberRole, () => string][] = [
		['family', 'owner', m.settings_member_role_owner],
		['family', 'admin', m.settings_member_role_admin],
		['family', 'member', m.settings_member_role_member],
		['business', 'owner', m.settings_member_role_owner],
		['business', 'admin', m.settings_member_role_admin],
		['business', 'member', m.settings_member_role_member]
	];

	it.each(shared)('shows the %s %s role from the store', (type, role, label) => {
		setWorkspace(type, role);
		const { container } = renderProfile();
		const tags = container.querySelectorAll('.pf-tags .badge');
		expect(tags).toHaveLength(1);
		expect(tags[0].textContent?.trim()).toBe(label());
	});

	it('shows no role before the members list has loaded', () => {
		setWorkspace('family', null);
		const { container } = renderProfile();
		expect(container.querySelector('.pf-tags')).toBeNull();
	});
});

describe('profile sending identity', () => {
	it('shows the primary address as text and sends changes to Addresses', () => {
		addresses.items = [
			address('p', 'ada@thelemail.com', { isPrimary: true, name: 'Ada' }),
			address('h', 'hello@thelemail.com')
		];
		setWorkspace('personal', 'owner');
		const { container } = renderProfile();
		const row = [...container.querySelectorAll('.setrow')].find((r) =>
			r.textContent?.includes(m.settings_profile_sending_identity())
		)!;
		expect(row.querySelector('select')).toBeNull();
		expect(row.textContent).toContain('ada@thelemail.com');
		expect(row.textContent).not.toContain('hello@thelemail.com');
		const link = row.querySelector('a')!;
		expect(link.textContent).toBe(m.settings_profile_sending_identity_change());
		expect(link.getAttribute('href')).toBe('/u/0/settings/addresses');
	});

	it('says there is no sending identity yet when no address exists', () => {
		setWorkspace('personal', 'owner');
		const { container } = renderProfile();
		expect(container.textContent).toContain(m.settings_profile_sending_identity_empty());
	});
});
