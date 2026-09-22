import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountAddress } from '$core/api/addresses';
import type { CalendarItem } from './model';

vi.mock('./store.svelte', () => ({ calendarStore: { calendar: () => null } }));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: { email: 'ada@thel.email', fullName: 'Ada Lovelace', accountId: 'me' }
}));
vi.mock('$core/keys/uid-sync', () => ({ syncAddressUids: vi.fn() }));

import { addresses } from '$core/stores/addresses.svelte';
import { identityFor } from './invite';

function address(id: string, email: string, over: Partial<AccountAddress> = {}): AccountAddress {
	return {
		id,
		accountId: 'me',
		email,
		localPart: email.split('@')[0],
		isPrimary: false,
		createdAt: '2026-09-01T00:00:00Z',
		updatedAt: '2026-09-01T00:00:00Z',
		...over
	};
}

function item(over: Partial<CalendarItem> = {}): CalendarItem {
	return {
		schemaVersion: 1,
		id: 'i1',
		kind: 'event',
		calendarId: 'c1',
		title: 'Planning',
		privacy: 'private',
		uid: 'u1',
		sequence: 0,
		createdAt: '2026-09-01T00:00:00Z',
		updatedAt: '2026-09-01T00:00:00Z',
		...over
	} as CalendarItem;
}

afterEach(() => {
	addresses.items = [];
});

describe('identityFor', () => {
	it('organises a new event from an address that can send', () => {
		addresses.items = [
			address('p', 'ada@acme.test', { isPrimary: true, suspended: true, name: 'Ada at Acme' }),
			address('w', 'ada@thel.email', { name: 'Ada' })
		];
		expect(identityFor(item())).toEqual({ email: 'ada@thel.email', name: 'Ada' });
	});

	it('keeps the primary as organiser while it can send', () => {
		addresses.items = [
			address('p', 'ada@acme.test', { isPrimary: true, name: 'Ada at Acme' }),
			address('w', 'ada@thel.email')
		];
		expect(identityFor(item())).toEqual({ email: 'ada@acme.test', name: 'Ada at Acme' });
	});

	it('keeps the organiser of an existing event', () => {
		addresses.items = [
			address('p', 'ada@acme.test', { isPrimary: true, suspended: true }),
			address('w', 'ada@thel.email')
		];
		const event = item({ organizer: { email: 'ada@acme.test', name: 'Ada' } });
		expect(identityFor(event).email).toBe('ada@acme.test');
	});
});
