import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import type { AccountAddress } from '$core/api/addresses';
import type { CustomDomain } from '$core/api/customDomains';
import { addresses } from '$core/stores/addresses.svelte';
import { customDomains } from '$core/stores/customDomains.svelte';
import Addresses from './Addresses.svelte';

vi.mock('$app/state', () => ({ page: { params: { slot: '0' } } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: { accountId: 'me', fullName: 'Ada Lovelace', email: 'ada@thelemail.com' }
}));
vi.mock('../permissions', () => ({ canManageWorkspace: () => false, isWorkspaceOwner: () => false }));
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
	addresses.items = [];
	customDomains.clear();
});

describe('Addresses', () => {
	it('badges a suspended address and says why', () => {
		render(Addresses, { props: { s: {} as never, set: () => {}, launch: () => {} } });
		const suspended = rowOf('sales@acme.co.uk').textContent ?? '';
		expect(suspended).toContain('Suspended');
		expect(suspended).toContain('Cannot send or receive mail until acme.co.uk is verified again.');
		expect(rowOf('hello@thelemail.com').textContent).not.toContain('Suspended');
	});

	it('leaves make primary out of the menu for a suspended address', async () => {
		render(Addresses, { props: { s: {} as never, set: () => {}, launch: () => {} } });
		expect(await menuOf('sales@acme.co.uk')).not.toContain('Make primary');
		expect(await menuOf('hello@thelemail.com')).toContain('Make primary');
	});
});
