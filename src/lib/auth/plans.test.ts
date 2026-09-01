import { describe, expect, it } from 'vitest';
import { planFromQuery } from './plans';

describe('planFromQuery', () => {
	it('maps every pricing id to its product and tier', () => {
		expect(planFromQuery('personal')).toEqual({ product: 'personal', tier: 'personal', seats: 3 });
		expect(planFromQuery('personal-plus')).toEqual({
			product: 'personal',
			tier: 'personal-plus',
			seats: 3
		});
		expect(planFromQuery('family')).toEqual({ product: 'family', tier: 'family', seats: 3 });
		expect(planFromQuery('family-plus')).toEqual({ product: 'family', tier: 'family-plus', seats: 3 });
		expect(planFromQuery('team')).toEqual({ product: 'business', tier: 'team', seats: 3 });
		expect(planFromQuery('business')).toEqual({ product: 'business', tier: 'business', seats: 3 });
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
});
