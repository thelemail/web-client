import { describe, it, expect } from 'vitest';
import type { CustomDomain } from '$core/api/customDomains';
import { DOMAIN_STEPS, reachableStep, stepReachable } from './steps';

const at = '2026-09-21T12:00:00Z';

function domain(over: Partial<CustomDomain> = {}): CustomDomain {
	return {
		id: 'd1',
		workspaceId: 'w1',
		domain: 'acme.test',
		status: 'pending',
		addressCount: 0,
		createdAt: at,
		updatedAt: at,
		...over
	};
}

const owned = domain({ status: 'owned', ownershipVerifiedAt: at });
const live = domain({
	status: 'active',
	ownershipVerifiedAt: at,
	dkimVerifiedAt: at,
	spfVerifiedAt: at,
	dmarcVerifiedAt: at,
	mxVerifiedAt: at,
	addressCount: 2
});

describe('stepReachable', () => {
	it('keeps an unproven domain on the ownership step', () => {
		const d = domain();
		expect(DOMAIN_STEPS.filter((s) => stepReachable(d, s))).toEqual(['ownership']);
	});

	it('opens the setup steps once ownership is proven', () => {
		expect(stepReachable(owned, 'sending')).toBe(true);
		expect(stepReachable(owned, 'recipients')).toBe(true);
		expect(stepReachable(owned, 'routing')).toBe(true);
	});

	it('holds back the done step until the domain is live with addresses', () => {
		expect(stepReachable(owned, 'done')).toBe(false);
		expect(stepReachable({ ...live, addressCount: 0 }, 'done')).toBe(false);
		expect(stepReachable({ ...live, mxVerifiedAt: null }, 'done')).toBe(false);
		expect(stepReachable(live, 'done')).toBe(true);
	});
});

describe('reachableStep', () => {
	it('sends a deep link past ownership back to ownership', () => {
		expect(reachableStep(domain(), 'recipients')).toBe('ownership');
		expect(reachableStep(domain(), 'done')).toBe('ownership');
	});

	it('sends an early done link to the step still missing', () => {
		expect(reachableStep(owned, 'done')).toBe('sending');
	});

	it('keeps a reachable step as asked', () => {
		expect(reachableStep(owned, 'routing')).toBe('routing');
		expect(reachableStep(live, 'done')).toBe('done');
	});
});
