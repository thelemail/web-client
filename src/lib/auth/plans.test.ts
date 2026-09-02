import { describe, expect, it } from 'vitest';
import {
	annualSavingPercent,
	eur,
	findPlan,
	periodFromQuery,
	planFromQuery,
	planLabelFor,
	planTotal,
	PRODUCTS,
	selectionForCode
} from './plans';

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

describe('planLabelFor', () => {
	it('labels the plan with its billing period', () => {
		expect(planLabelFor('family', 1, 'year')).toBe('Family · €60 / year');
		expect(planLabelFor('family', 1, 'month')).toBe('Family · €6.50 / month');
	});

	it('defaults to annual and degrades on unknown codes', () => {
		expect(planLabelFor('family', 1)).toBe('Family · €60 / year');
		expect(planLabelFor('enterprise_max', 1)).toBe('enterprise max');
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
