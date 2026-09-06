import { describe, it, expect } from 'vitest';
import { planLabel, seatLimitFor, isInvitable, seatsFullNote, freeNote } from './plan-display';

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
	it('gives a family six seats whether it pays or not', () => {
		expect(seatLimitFor('family')).toBe(6);
	});

	it('keeps personal at one and business at what was bought', () => {
		expect(seatLimitFor('personal')).toBe(1);
		expect(seatLimitFor('business', 12)).toBe(12);
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
		const note = seatsFullNote('family', 6, 'free_family');
		expect(note).not.toMatch(/Business/);
		expect(note).toMatch(/6 seats/);
	});

	it('still points a paid family at Business', () => {
		expect(seatsFullNote('family', 6, 'family')).toMatch(/Business/);
	});
});

describe('freeNote', () => {
	it('describes a family as six accounts', () => {
		expect(freeNote('family', 'free_family')).toMatch(/6 accounts/);
	});

	it('describes a personal free account as one person', () => {
		expect(freeNote('personal', 'free')).toMatch(/one person/);
	});
});
