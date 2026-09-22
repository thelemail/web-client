import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountAddress } from '$core/api/addresses';
import type { SharedAlias } from '$core/api/aliases';

const api = vi.hoisted(() => ({
	listMyAddresses: vi.fn(),
	updateMyAddress: vi.fn(),
	setPrimaryAddress: vi.fn(),
	removeAddress: vi.fn()
}));
const aliasApi = vi.hoisted(() => ({ listMySharedAliases: vi.fn() }));
vi.mock('$core/api/addresses', () => api);
vi.mock('$core/api/aliases', () => aliasApi);
vi.mock('$core/keys/uid-sync', () => ({ syncAddressUids: vi.fn() }));

import { addresses } from './addresses.svelte';

function address(id: string, over: Partial<AccountAddress> = {}): AccountAddress {
	return {
		id,
		accountId: 'a1',
		email: `${id}@acme.test`,
		localPart: id,
		isPrimary: false,
		createdAt: '2026-09-01T00:00:00Z',
		updatedAt: '2026-09-01T00:00:00Z',
		...over
	};
}

function alias(over: Partial<SharedAlias> = {}): SharedAlias {
	return {
		id: 'al1',
		workspaceId: 'w1',
		addressId: 'sa1',
		customDomainId: 'd1',
		email: 'sales@acme.test',
		localPart: 'sales',
		name: 'Sales',
		keyVersion: 1,
		aliasPublicKeyArmored: '',
		keyAlgorithm: 'x25519',
		memberCount: 1,
		rotationRequired: false,
		members: [],
		createdAt: '2026-09-01T00:00:00Z',
		updatedAt: '2026-09-01T00:00:00Z',
		...over
	};
}

beforeEach(() => {
	addresses.setAccount('a1');
});

afterEach(() => {
	addresses.clear();
	vi.clearAllMocks();
});

describe('addresses store', () => {
	it('leaves suspended addresses out of what can send', () => {
		addresses.items = [
			address('p', { isPrimary: true }),
			address('w', { suspended: true }),
			address('s', { shared: true, sharedAliasId: 'al1' })
		];
		expect(addresses.sendable.map((a) => a.id)).toEqual(['p', 's']);
	});

	it('falls back to the oldest personal address when the primary is suspended', () => {
		addresses.items = [
			address('p', { isPrimary: true, suspended: true }),
			address('s', { shared: true, sharedAliasId: 'al1' }),
			address('old'),
			address('new')
		];
		expect(addresses.defaultSender?.id).toBe('old');
		expect(addresses.primary?.id).toBe('p');
	});

	it('keeps the primary as default sender while it can send', () => {
		addresses.items = [address('p', { isPrimary: true }), address('w')];
		expect(addresses.defaultSender?.id).toBe('p');
	});

	it('has no default sender when every personal address is suspended', () => {
		addresses.items = [
			address('p', { isPrimary: true, suspended: true }),
			address('s', { shared: true, sharedAliasId: 'al1' })
		];
		expect(addresses.defaultSender).toBeNull();
	});

	it('carries suspension over from shared aliases', async () => {
		api.listMyAddresses.mockResolvedValue({ addresses: [] });
		aliasApi.listMySharedAliases.mockResolvedValue({
			sharedAliases: [alias({ suspended: true })]
		});
		await addresses.load();
		expect(addresses.items[0]).toMatchObject({ id: 'sa1', shared: true, suspended: true });
		expect(addresses.sendable).toEqual([]);
	});
});
