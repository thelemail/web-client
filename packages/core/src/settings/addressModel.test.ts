import { describe, it, expect } from 'vitest';
import type { AccountAddress } from '$core/api/addresses';
import type { SharedAlias } from '$core/api/aliases';
import type { CustomDomain } from '$core/api/customDomains';
import type { WorkspaceMember } from '$core/api/workspaces';
import type { ReadDelegation } from '$core/api/readDelegations';
import type { SigningDelegation } from '$core/api/delegations';
import {
	buildRow,
	groupByDomain,
	dedupeAddresses,
	ledeFor,
	usedByLabel,
	type ModelContext
} from './addressModel';

const ME = 'acct-me';
const OTHER = 'acct-other';
const OWN_DOMAIN_ID = 'dom-1';

function member(accountId: string, fullName: string, email: string): WorkspaceMember {
	return { workspaceId: 'ws', accountId, email, fullName, role: 'member', joinedAt: '' };
}

function address(over: Partial<AccountAddress> & { id: string; email: string }): AccountAddress {
	return {
		accountId: ME,
		localPart: over.email.split('@')[0],
		customDomainId: OWN_DOMAIN_ID,
		name: null,
		isPrimary: false,
		createdAt: '',
		updatedAt: '',
		...over
	};
}

function sharedAlias(over: Partial<SharedAlias> & { id: string; addressId: string }): SharedAlias {
	return {
		workspaceId: 'ws',
		customDomainId: OWN_DOMAIN_ID,
		email: 'support@abbaye.example',
		localPart: 'support',
		name: 'Support',
		keyVersion: 1,
		aliasPublicKeyArmored: '',
		keyAlgorithm: 'openpgp-ed25519',
		memberCount: 0,
		rotationRequired: false,
		members: [],
		createdAt: '',
		updatedAt: '',
		...over
	};
}

function ctx(over: Partial<ModelContext> = {}): ModelContext {
	return {
		accountId: ME,
		manage: true,
		members: [member(ME, 'Gargantua', 'gargantua@abbaye.example'), member(OTHER, 'Panurge', 'panurge@abbaye.example')],
		domains: [{ domain: 'abbaye.example' } as CustomDomain],
		sharedAliases: [],
		fullName: 'Gargantua',
		delegationsFor: () => [],
		forwardingFor: () => [],
		...over
	};
}

describe('buildRow', () => {
	it('names another member as the user of their alias', () => {
		const row = buildRow(
			ctx(),
			address({ id: 'a1', email: 'billing@abbaye.example', accountId: OTHER, name: 'Billing' })
		);
		expect(row.usedBy).toBe('Panurge');
		expect(row.isMine).toBe(false);
		expect(row.isOwnPersonal).toBe(false);
	});

	it('says You for an address of your own', () => {
		const row = buildRow(ctx(), address({ id: 'a2', email: 'abbot@abbaye.example', name: 'The Abbot' }));
		expect(row.usedBy).toBe('You');
		expect(row.canDelegate).toBe(true);
		expect(row.canForward).toBe(true);
	});

	it('withholds delegation and forwarding on the shared domain', () => {
		const row = buildRow(
			ctx(),
			address({ id: 'a3', email: 'gargantua@thelemail.com', customDomainId: null })
		);
		expect(row.canDelegate).toBe(false);
		expect(row.canForward).toBe(false);
	});

	it('never offers to remove or promote the primary address', () => {
		const row = buildRow(ctx(), address({ id: 'a4', email: 'gargantua@abbaye.example', isPrimary: true }));
		expect(row.canRemove).toBe(false);
		expect(row.canPromote).toBe(false);
		expect(row.kind).toBe('mailbox');
	});

	it('counts people on a shared alias and carries its rotation flag', () => {
		const alias = sharedAlias({
			id: 's1',
			addressId: 'a5',
			rotationRequired: true,
			members: [
				{ accountId: ME, email: 'gargantua@abbaye.example', fullName: 'Gargantua', canSend: true, grantedKeyVersion: 1 },
				{ accountId: OTHER, email: 'panurge@abbaye.example', fullName: 'Panurge', canSend: true, grantedKeyVersion: 1 }
			]
		});
		const row = buildRow(
			ctx({ sharedAliases: [alias] }),
			address({ id: 'a5', email: 'support@abbaye.example', shared: true, sharedAliasId: 's1' })
		);
		expect(row.kind).toBe('shared');
		expect(row.title).toBe('Support');
		expect(row.usedBy).toBe('You and 1 other');
		expect(row.rotationRequired).toBe(true);
		expect(row.canManagePeople).toBe(true);
		expect(row.canForward).toBe(true);
	});

	it('summarises signing and forwarding for the row', () => {
		const delegations = [
			{ revokedAt: null } as SigningDelegation,
			{ revokedAt: '2026-08-30' } as SigningDelegation
		];
		const forwardings = [
			{ label: 'Helpdesk', state: 'active' } as ReadDelegation,
			{ label: 'Gmail', state: 'pending_verification' } as ReadDelegation
		];
		const row = buildRow(
			ctx({ delegationsFor: () => delegations, forwardingFor: () => forwardings }),
			address({ id: 'a6', email: 'abbot@abbaye.example' })
		);
		expect(row.signerSummary).toBe('1 service may sign');
		expect(row.forwardSummary).toBe('Forwards to Helpdesk');
		expect(row.pendingSummary).toBe('1 destination unconfirmed');
	});
});

describe('usedByLabel', () => {
	it('reads Only you when you are alone on a shared alias', () => {
		const people = [{ accountId: ME, name: 'Gargantua', email: '' }];
		expect(usedByLabel(ctx(), { kind: 'shared', people })).toBe('Only you');
	});

	it('counts people when you are not on it', () => {
		const people = [
			{ accountId: OTHER, name: 'Panurge', email: '' },
			{ accountId: 'x', name: 'Frere Jean', email: '' }
		];
		expect(usedByLabel(ctx(), { kind: 'shared', people })).toBe('2 people');
	});
});

describe('groupByDomain', () => {
	it('puts owned domains before the shared one and labels each group', () => {
		const c = ctx();
		const rows = [
			buildRow(c, address({ id: 'a1', email: 'gargantua@thelemail.com', customDomainId: null })),
			buildRow(c, address({ id: 'a2', email: 'abbot@abbaye.example' })),
			buildRow(c, address({ id: 'a3', email: 'gargantua@abbaye.example', isPrimary: true }))
		];
		const groups = groupByDomain(c, rows);
		expect(groups.map((g) => g.domain)).toEqual(['abbaye.example', 'thelemail.com']);
		expect(groups[0].badge).toBe('Your domain · verified');
		expect(groups[0].count).toBe('2 addresses');
		expect(groups[1].badge).toBe('Included with your plan');
		expect(groups[1].count).toBe('1 address');
		expect(groups[0].rows[0].isPrimary).toBe(true);
	});
});

describe('dedupeAddresses', () => {
	it('keeps the first copy of an address seen across lists', () => {
		const mine = address({ id: 'a1', email: 'abbot@abbaye.example', name: 'The Abbot' });
		const workspace = address({ id: 'a1', email: 'abbot@abbaye.example', name: null });
		const out = dedupeAddresses([[mine], [workspace, address({ id: 'a2', email: 'b@abbaye.example' })]]);
		expect(out).toHaveLength(2);
		expect(out[0].name).toBe('The Abbot');
	});
});

describe('ledeFor', () => {
	it('explains an alias that belongs to someone else', () => {
		const c = ctx();
		const row = buildRow(c, address({ id: 'a1', email: 'billing@abbaye.example', accountId: OTHER }));
		expect(ledeFor(c, row)).toContain('belongs to Panurge');
	});
});
