import { beforeAll, describe, it, expect, vi } from 'vitest';
import { platformDomains } from '$core/stores/platformDomains.svelte';
import { planLabel, seatLimitFor, isInvitable, seatsFullNote, freeNote } from './plan-display';
import type { Plan } from '$core/api/billing';

vi.mock('$core/api/auth', () => ({
	getPlatformDomains: vi.fn().mockResolvedValue({
		domains: ['temail.org'],
		hosted: ['temail.org', 'thelemail.com'],
		default: 'temail.org'
	})
}));

beforeAll(() => platformDomains.load());

function plan(over: Partial<Plan> = {}): Plan {
	return {
		code: 'family',
		workspaceType: 'family',
		displayName: 'Family',
		pricingModel: 'flat',
		currency: 'eur',
		yearlyAmountCents: 6000,
		monthlyAmountCents: 650,
		minSeats: 1,
		maxSeats: 4,
		storageBytesPerMailbox: 2 * 1024 ** 3,
		customDomainsLimit: 0,
		auditRetentionDays: 30,
		prioritySupport: 'none',
		...over
	};
}

describe('planLabel', () => {
	it('names the two free tiers apart', () => {
		expect(planLabel('personal', 'free')).toBe('Free');
		expect(planLabel('family', 'free_family')).toBe('Free family');
	});

	it('falls back to the workspace type for paid plans', () => {
		expect(planLabel('family', 'family')).toBe('Family');
		expect(planLabel('business', 'team')).toBe('Business');
		expect(planLabel('personal', 'personal_plus')).toBe('Personal');
	});
});

describe('seatLimitFor', () => {
	it('takes a flat plan limit from the catalog', () => {
		expect(seatLimitFor(plan())).toBe(4);
		expect(seatLimitFor(plan({ code: 'personal', maxSeats: 1 }))).toBe(1);
	});

	it('uses the bought seats on per-mailbox plans', () => {
		expect(seatLimitFor(plan({ code: 'business', pricingModel: 'per_mailbox', maxSeats: undefined }), 12)).toBe(12);
	});

	it('does not guess before the catalog loads', () => {
		expect(seatLimitFor(null, 12)).toBeNull();
		expect(seatLimitFor(undefined)).toBeNull();
	});
});

describe('isInvitable', () => {
	it('covers family and business only', () => {
		expect(isInvitable('family')).toBe(true);
		expect(isInvitable('business')).toBe(true);
		expect(isInvitable('personal')).toBe(false);
	});
});

describe('seatsFullNote', () => {
	it('does not push Business at a free family', () => {
		const note = seatsFullNote('family', 4, 'free_family');
		expect(note).not.toMatch(/Business/);
		expect(note).toMatch(/All 4 seats/);
	});

	it('still points a paid family at Business', () => {
		const note = seatsFullNote('family', 4, 'family');
		expect(note).toMatch(/All 4 included seats/);
		expect(note).toMatch(/Business/);
	});

	it('says nothing about a family limit it does not know', () => {
		expect(seatsFullNote('family', null, 'family')).toBeNull();
	});
});

describe('freeNote', () => {
	it('describes a family with the plan seats and storage', () => {
		const note = freeNote('family', 'free_family', plan({ code: 'free_family' }));
		expect(note).toMatch(/Up to 4 accounts/);
		expect(note).toMatch(/2 GB of storage/);
		expect(note).toContain('an address on temail.org');
		expect(note).not.toContain('thelemail.com');
	});

	it('describes a personal free account as one person', () => {
		const note = freeNote('personal', 'free', plan({ code: 'free', maxSeats: 1, storageBytesPerMailbox: 512 * 1024 ** 2 }));
		expect(note).toMatch(/one person/);
		expect(note).toMatch(/512 MB of storage/);
		expect(note).toContain('an address on temail.org');
	});

	it('waits for the catalog', () => {
		expect(freeNote('family', 'free_family', null)).toBeNull();
	});
});
