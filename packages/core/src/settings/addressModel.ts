import type { AccountAddress } from '$core/api/addresses';
import type { SharedAlias, SharedAliasMember } from '$core/api/aliases';
import type { CustomDomain } from '$core/api/customDomains';
import { isDormant, ownershipProven } from '$core/settings/domains/steps';
import type { WorkspaceMember } from '$core/api/workspaces';
import type { ReadDelegation } from '$core/api/readDelegations';
import type { SigningDelegation } from '$core/api/delegations';
import { m } from '$paraglide/messages.js';
import { SHARED_DOMAIN } from './entitlements';

export type AddressKind = 'mailbox' | 'alias' | 'shared';

export interface AddressPerson {
	accountId: string;
	name: string;
	email: string;
}

export interface AddressRow {
	id: string;
	sharedAliasId: string | null;
	email: string;
	localPart: string;
	domain: string;
	customDomainId: string | null;
	title: string;
	kind: AddressKind;
	ownerAccountId: string;
	people: AddressPerson[];
	isPrimary: boolean;
	isMine: boolean;
	isOwnPersonal: boolean;
	rotationRequired: boolean;
	usedBy: string;
	signerSummary: string;
	forwardSummary: string;
	pendingSummary: string;
	canPromote: boolean;
	canRename: boolean;
	canRemove: boolean;
	canManagePeople: boolean;
	canDelegate: boolean;
	canForward: boolean;
}

export interface AddressGroup {
	domain: string;
	ownDomain: boolean;
	badge: string;
	badgeTone: 'pine' | 'neutral' | 'warn';
	count: string;
	rows: AddressRow[];
}

export interface ModelContext {
	accountId: string | null;
	manage: boolean;
	members: WorkspaceMember[];
	domains: CustomDomain[];
	sharedAliases: SharedAlias[];
	fullName: string | null;
	delegationsFor: (addressId: string) => SigningDelegation[];
	forwardingFor: (addressId: string) => ReadDelegation[];
}

export function domainOf(email: string): string {
	const at = email.lastIndexOf('@');
	return at < 0 ? '' : email.slice(at + 1).toLowerCase();
}

export function personFor(ctx: ModelContext, accountId: string): AddressPerson {
	const member = ctx.members.find((m) => m.accountId === accountId);
	if (member) return { accountId, name: member.fullName || member.email, email: member.email };
	if (accountId && accountId === ctx.accountId) {
		return { accountId, name: ctx.fullName ?? m.settings_address_you(), email: '' };
	}
	return { accountId, name: m.settings_address_another_member(), email: '' };
}

export function usedByLabel(ctx: ModelContext, row: Pick<AddressRow, 'kind' | 'people'>): string {
	if (row.kind === 'shared') {
		const mine = row.people.some((p) => p.accountId === ctx.accountId);
		const n = row.people.length;
		if (mine && n === 1) return m.settings_address_used_only_you();
		if (mine) return m.settings_address_used_you_and_others({ count: n - 1 });
		return m.settings_address_used_people({ count: n });
	}
	const owner = row.people[0];
	if (!owner) return '';
	return owner.accountId === ctx.accountId ? m.settings_address_you() : owner.name;
}

function signerSummary(items: SigningDelegation[]): string {
	const active = items.filter((d) => !d.revokedAt).length;
	if (!active) return '';
	return m.settings_address_signers_summary({ count: active });
}

function forwardSummary(items: ReadDelegation[]): string {
	const live = items.filter((f) => f.state === 'active' || f.state === 'paused');
	if (!live.length) return '';
	return m.settings_address_forwards_to({ targets: live.map((f) => f.label).join(', ') });
}

function pendingSummary(items: ReadDelegation[]): string {
	const pending = items.filter((f) => f.state === 'pending_verification').length;
	if (!pending) return '';
	return m.settings_address_pending_summary({ count: pending });
}

function sharedPeople(members: SharedAliasMember[]): AddressPerson[] {
	return members.map((m) => ({
		accountId: m.accountId,
		name: m.fullName || m.email,
		email: m.email
	}));
}

export function buildRow(ctx: ModelContext, address: AccountAddress): AddressRow {
	const alias = address.sharedAliasId
		? (ctx.sharedAliases.find((a) => a.id === address.sharedAliasId) ?? null)
		: (ctx.sharedAliases.find((a) => a.addressId === address.id) ?? null);
	const kind: AddressKind = alias || address.shared ? 'shared' : address.isPrimary ? 'mailbox' : 'alias';
	const ownDomain = Boolean(address.customDomainId);
	const isMine = address.accountId === ctx.accountId;
	const people =
		kind === 'shared'
			? alias
				? sharedPeople(alias.members)
				: []
			: [personFor(ctx, address.accountId)];
	const delegations = ctx.delegationsFor(address.id);
	const forwardings = ctx.forwardingFor(address.id);
	const own = kind !== 'shared' && isMine;

	const row: AddressRow = {
		id: address.id,
		sharedAliasId: alias?.id ?? address.sharedAliasId ?? null,
		email: address.email,
		localPart: address.localPart,
		domain: domainOf(address.email),
		customDomainId: address.customDomainId ?? null,
		title: titleOf(ctx, address, alias, isMine),
		kind,
		ownerAccountId: address.accountId,
		people,
		isPrimary: address.isPrimary && isMine,
		isMine,
		isOwnPersonal: own,
		rotationRequired: Boolean(alias?.rotationRequired),
		usedBy: '',
		signerSummary: signerSummary(delegations),
		forwardSummary: forwardSummary(forwardings),
		pendingSummary: pendingSummary(forwardings),
		canPromote: own && !address.isPrimary,
		canRename: own || (kind === 'shared' && ctx.manage),
		canRemove: (own && !address.isPrimary) || (kind !== 'mailbox' && ctx.manage && !address.isPrimary),
		canManagePeople: kind === 'shared' && ctx.manage,
		canDelegate: ownDomain && own,
		canForward: ownDomain && (own || (kind === 'shared' && ctx.manage))
	};
	row.usedBy = usedByLabel(ctx, row);
	return row;
}

function titleOf(
	ctx: ModelContext,
	address: AccountAddress,
	alias: SharedAlias | null,
	isMine: boolean
): string {
	if (alias?.name) return alias.name;
	if (address.name) return address.name;
	if (isMine && ctx.fullName) return ctx.fullName;
	if (!isMine) {
		const owner = ctx.members.find((m) => m.accountId === address.accountId);
		if (owner?.fullName) return owner.fullName;
	}
	return address.localPart;
}

export function groupByDomain(ctx: ModelContext, rows: AddressRow[]): AddressGroup[] {
	const order: string[] = [];
	const byDomain = new Map<string, AddressRow[]>();
	for (const row of rows) {
		const list = byDomain.get(row.domain);
		if (list) {
			list.push(row);
			continue;
		}
		byDomain.set(row.domain, [row]);
		order.push(row.domain);
	}
	const owned = ctx.domains.map((d) => d.domain.toLowerCase());
	order.sort((a, b) => {
		const av = owned.includes(a) ? 0 : 1;
		const bv = owned.includes(b) ? 0 : 1;
		return av === bv ? a.localeCompare(b) : av - bv;
	});
	return order.map((domain) => {
		const list = byDomain.get(domain) ?? [];
		list.sort((a, b) => {
			if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
			return a.email.localeCompare(b.email);
		});
		const ownDomain = domain !== SHARED_DOMAIN;
		const row = ctx.domains.find((d) => d.domain.toLowerCase() === domain);
		return {
			domain,
			ownDomain,
			...groupBadge(ownDomain, row),
			count: m.settings_address_group_count({ count: list.length }),
			rows: list
		} satisfies AddressGroup;
	});
}

function groupBadge(
	ownDomain: boolean,
	row: CustomDomain | undefined
): { badge: string; badgeTone: AddressGroup['badgeTone'] } {
	if (!ownDomain) return { badge: m.settings_address_group_included(), badgeTone: 'neutral' };
	if (row && isDormant(row)) return { badge: m.settings_domains_status_paused(), badgeTone: 'warn' };
	if (row && !ownershipProven(row)) return { badge: m.settings_address_group_suspended(), badgeTone: 'warn' };
	return { badge: m.settings_address_group_own_domain(), badgeTone: 'pine' };
}

export function dedupeAddresses(lists: AccountAddress[][]): AccountAddress[] {
	const seen = new Map<string, AccountAddress>();
	for (const list of lists) {
		for (const a of list) {
			if (!seen.has(a.id)) seen.set(a.id, a);
		}
	}
	return [...seen.values()];
}

export function ledeFor(ctx: ModelContext, row: AddressRow): string {
	if (row.kind === 'shared') {
		return m.settings_address_lede_shared({ domain: row.domain });
	}
	if (row.isMine) {
		return row.kind === 'alias'
			? m.settings_address_lede_own_alias({ domain: row.domain })
			: m.settings_address_lede_mailbox({ domain: row.domain });
	}
	const owner = personFor(ctx, row.ownerAccountId);
	return m.settings_address_lede_other_alias({ domain: row.domain, name: owner.name });
}

export function planNote(sharedSlotUsed: boolean): string {
	return sharedSlotUsed
		? m.settings_address_plan_note_used({ domain: SHARED_DOMAIN })
		: m.settings_address_plan_note_free({ domain: SHARED_DOMAIN });
}

export function initialsOf(fullName: string, email: string): string {
	const src = (fullName || email).trim();
	const parts = src.split(/[\s@.]+/).filter(Boolean);
	return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src.slice(0, 2).toUpperCase();
}
