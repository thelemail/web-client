import { describe, expect, it } from 'vitest';
import { planUids } from './uidPlan';

describe('planUids', () => {
	it('keeps the primary address first instead of sorting', () => {
		const plan = planUids(['Vlad@TheLemail.com', 'vlad@temail.org', 'vlad@thelemail.com'], ['<vlad@thelemail.com>']);
		expect(plan.emails).toEqual(['vlad@thelemail.com', 'vlad@temail.org']);
		expect(plan.unchanged).toBe(false);
	});

	it('is unchanged when the set and the primary identity already match', () => {
		const plan = planUids(['vlad@thelemail.com', 'vlad@temail.org'], ['<vlad@thelemail.com>', '<vlad@temail.org>']);
		expect(plan.unchanged).toBe(true);
	});

	it('rebuilds the key when only the primary identity moved', () => {
		const plan = planUids(['vlad@temail.org', 'vlad@thelemail.com'], ['<vlad@thelemail.com>', '<vlad@temail.org>']);
		expect(plan.unchanged).toBe(false);
		expect(plan.emails[0]).toBe('vlad@temail.org');
	});

	it('ignores blanks', () => {
		expect(planUids([' ', ''], []).emails).toEqual([]);
	});
});
