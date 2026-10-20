import { describe, expect, it } from 'vitest';
import {
	annualSavingPercent,
	eur,
	findPlan,
	periodFromQuery,
	planFromQuery,
	planTotal,
	PRODUCTS,
	selectionForCode,
	subscriptionPlanLabel,
	subscriptionPrice
} from './plans';
import type { Plan, Subscription } from '$core/api/billing';

describe('planFromQuery', () => {
	it('maps every pricing id to its product and tier', () => {
		expect(planFromQuery('personal')).toEqual({
			product: 'personal',
			tier: 'personal',
			seats: 3,
			period: 'year'
		});
		expect(planFromQuery('personal-plus')).toEqual({
			product: 'personal',
			tier: 'personal-plus',
			seats: 3,
			period: 'year'
		});
		expect(planFromQuery('family')).toEqual({
			product: 'family',
			tier: 'family',
			seats: 3,
			period: 'year'
		});
		expect(planFromQuery('family-plus')).toEqual({
			product: 'family',
			tier: 'family-plus',
			seats: 3,
			period: 'year'
		});
		expect(planFromQuery('team')).toEqual({
			product: 'business',
			tier: 'team',
			seats: 3,
			period: 'year'
		});
		expect(planFromQuery('business')).toEqual({
			product: 'business',
			tier: 'business',
			seats: 3,
			period: 'year'
		});
	});

	it('accepts underscore and upper-case forms', () => {
		expect(planFromQuery('Personal_Plus')?.tier).toBe('personal-plus');
		expect(planFromQuery(' FAMILY ')?.tier).toBe('family');
	});

	it('returns null for missing, free or unknown values', () => {
		expect(planFromQuery(null)).toBeNull();
		expect(planFromQuery(undefined)).toBeNull();
		expect(planFromQuery('')).toBeNull();
		expect(planFromQuery('free')).toBeNull();
		expect(planFromQuery('free_family')).toBeNull();
		expect(planFromQuery('free-family')).toBeNull();
		expect(planFromQuery('enterprise')).toBeNull();
		expect(planFromQuery('<script>')).toBeNull();
	});

	it('carries the requested billing period', () => {
		expect(planFromQuery('family', 'month')?.period).toBe('month');
		expect(planFromQuery('family')?.period).toBe('year');
	});
});

describe('periodFromQuery', () => {
	it('reads the landing page billing parameter', () => {
		expect(periodFromQuery('monthly')).toBe('month');
		expect(periodFromQuery('month')).toBe('month');
		expect(periodFromQuery(' MONTHLY ')).toBe('month');
	});

	it('falls back to annual for anything else', () => {
		expect(periodFromQuery(null)).toBe('year');
		expect(periodFromQuery(undefined)).toBe('year');
		expect(periodFromQuery('')).toBe('year');
		expect(periodFromQuery('yearly')).toBe('year');
		expect(periodFromQuery('weekly')).toBe('year');
	});
});

describe('planTotal', () => {
	it('charges the flat price for the selected period', () => {
		expect(planTotal(selectionForCode('family', 3, 'year')!)).toBe(60);
		expect(planTotal(selectionForCode('family', 3, 'month')!)).toBe(6.5);
	});

	it('multiplies per-mailbox plans by seats', () => {
		expect(planTotal(selectionForCode('team', 4, 'year')!)).toBe(216);
		expect(planTotal(selectionForCode('team', 4, 'month')!)).toBe(24);
	});

	it('is zero when no tier is chosen', () => {
		expect(planTotal({ product: 'personal', tier: null, seats: 3, period: 'year' })).toBe(0);
	});
});

describe('eur', () => {
	it('drops decimals on whole amounts and keeps cents otherwise', () => {
		expect(eur(24)).toBe('€24');
		expect(eur(6.5)).toBe('€6.50');
		expect(eur(4.5)).toBe('€4.50');
		expect(eur(0)).toBe('€0');
	});
});

describe('annualSavingPercent', () => {
	it('matches the published saving for every paid tier', () => {
		const savings = Object.fromEntries(
			PRODUCTS.flatMap((p) => p.tiers.map((t) => [t.id, annualSavingPercent(t)]))
		);
		expect(savings).toEqual({
			personal: 33,
			'personal-plus': 20,
			family: 23,
			'family-plus': 20,
			team: 25,
			business: 22
		});
	});
});

function plan(over: Partial<Plan> = {}): Plan {
	return {
		code: 'family',
		workspaceType: 'family',
		displayName: 'Family',
		pricingModel: 'flat',
		currency: 'eur',
		yearlyAmountCents: 7200,
		monthlyAmountCents: 750,
		minSeats: 1,
		maxSeats: 6,
		storageBytesPerMailbox: 10 * 1024 ** 3,
		customDomainsLimit: 2,
		auditRetentionDays: 30,
		prioritySupport: 'none',
		...over
	};
}

function sub(over: Partial<Subscription> = {}): Subscription {
	return {
		status: 'active',
		entitled: true,
		planCode: 'family',
		interval: 'year',
		cancelAtPeriodEnd: false,
		provider: 'stripe',
		...over
	};
}

const team = plan({
	code: 'team',
	workspaceType: 'business',
	displayName: 'Team',
	pricingModel: 'per_mailbox',
	yearlyAmountCents: 6000,
	monthlyAmountCents: 650,
	minSeats: 3,
	maxSeats: undefined
});

describe('subscriptionPrice', () => {
	it('prices a flat plan from the catalog for each interval', () => {
		expect(subscriptionPrice(plan(), sub())).toMatchObject({ total: '€72', period: 'year', perMailbox: false });
		expect(subscriptionPrice(plan(), sub({ interval: 'month' }))).toMatchObject({ total: '€7.50', period: 'month' });
	});

	it('multiplies per-mailbox plans by the subscribed seats only', () => {
		const price = subscriptionPrice(team, sub({ planCode: 'team', seats: 4 }));
		expect(price).toEqual({ unit: '€60', total: '€240', seats: 4, period: 'year', perMailbox: true });
		expect(subscriptionPrice(plan(), sub({ seats: 4 }))?.total).toBe('€72');
	});

	it('formats in the currency the server returns', () => {
		expect(subscriptionPrice(plan({ currency: 'usd' }), sub())?.total).toBe('$72');
	});

	it('shows nothing it cannot back with catalog data', () => {
		expect(subscriptionPrice(null, sub())).toBeNull();
		expect(subscriptionPrice(plan({ code: 'family_plus' }), sub())).toBeNull();
		expect(subscriptionPrice(plan(), sub({ interval: undefined }))).toBeNull();
		expect(subscriptionPrice(plan(), sub({ provider: 'apple' }))).toBeNull();
		expect(subscriptionPrice(plan(), sub({ provider: 'google_play' }))).toBeNull();
	});
});

describe('subscriptionPlanLabel', () => {
	it('labels the plan with the catalog price and period', () => {
		expect(subscriptionPlanLabel(plan(), sub())).toBe('Family · €72 / year');
		expect(subscriptionPlanLabel(plan(), sub({ interval: 'month' }))).toBe('Family · €7.50 / month');
	});

	it('falls back to the name when there is no price', () => {
		expect(subscriptionPlanLabel(null, sub())).toBe('Family');
		expect(subscriptionPlanLabel(plan(), sub({ provider: 'apple' }))).toBe('Family');
		expect(subscriptionPlanLabel(null, sub({ planCode: 'enterprise_max' as never }))).toBe('enterprise max');
		expect(subscriptionPlanLabel(null, sub({ planCode: undefined }))).toBeNull();
	});
});

describe('findPlan', () => {
	it('falls back to the personal product for an unknown selection', () => {
		const { product, tier } = findPlan({
			product: 'nope' as never,
			tier: 'nope',
			seats: 1,
			period: 'year'
		});
		expect(product.id).toBe('personal');
		expect(tier).toBeNull();
	});
});
