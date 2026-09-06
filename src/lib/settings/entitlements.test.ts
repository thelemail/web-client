import { describe, it, expect } from 'vitest';
import {
	allowsCustomDomains,
	allowsMembers,
	allowsSharedAddresses,
	inviteMode,
	isFreeFamily,
	isFreePlan,
	isSharedDomainAddress
} from './entitlements';
import type { PlanCode } from '$lib/api/billing';

const ALL: PlanCode[] = [
	'free',
	'free_family',
	'personal',
	'personal_plus',
	'family',
	'family_plus',
	'team',
	'business'
];

describe('plan capabilities', () => {
	it('treats both free tiers as free', () => {
		expect(ALL.filter(isFreePlan)).toEqual(['free', 'free_family']);
	});

	it('gives neither free tier a custom domain or a shared address', () => {
		for (const code of ALL) {
			const paid = !isFreePlan(code);
			expect(allowsCustomDomains(code)).toBe(paid);
			expect(allowsSharedAddresses(code)).toBe(paid);
		}
	});

	it('lets a free family hold members but not a free personal account', () => {
		expect(allowsMembers('free')).toBe(false);
		expect(allowsMembers('free_family')).toBe(true);
		expect(allowsMembers('family')).toBe(true);
		expect(allowsMembers('business')).toBe(true);
	});

	it('tolerates a missing subscription', () => {
		for (const fn of [isFreePlan, isFreeFamily, allowsCustomDomains, allowsSharedAddresses, allowsMembers]) {
			expect(fn(null)).toBe(false);
			expect(fn(undefined)).toBe(false);
		}
	});
});

describe('inviteMode', () => {
	it('invites existing accounts only on a free family', () => {
		expect(inviteMode('family', 'free_family')).toBe('existing-account');
	});

	it('keeps the domain requirement for paid workspaces', () => {
		expect(inviteMode('family', 'family')).toBe('domain');
		expect(inviteMode('family', 'family_plus')).toBe('domain');
		expect(inviteMode('business', 'team')).toBe('domain');
		expect(inviteMode('business', 'business')).toBe('domain');
	});

	it('never invites from a personal workspace', () => {
		for (const code of ALL) {
			expect(inviteMode('personal', code)).toBe('none');
		}
		expect(inviteMode(null, 'free_family')).toBe('none');
	});

	it('never invites on the free personal plan', () => {
		expect(inviteMode('family', 'free')).toBe('none');
	});
});

describe('isSharedDomainAddress', () => {
	it('accepts thelemail.com in any case', () => {
		expect(isSharedDomainAddress('anna@thelemail.com')).toBe(true);
		expect(isSharedDomainAddress('Anna@Thelemail.COM')).toBe(true);
	});

	it('rejects anything else', () => {
		expect(isSharedDomainAddress('anna@example.com')).toBe(false);
		expect(isSharedDomainAddress('anna@sub.thelemail.com')).toBe(false);
		expect(isSharedDomainAddress('anna')).toBe(false);
		expect(isSharedDomainAddress('')).toBe(false);
	});
});
