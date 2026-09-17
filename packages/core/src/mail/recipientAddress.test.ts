import { describe, it, expect } from 'vitest';
import vectors from './fixtures/recipient_address_vectors.json';
import { canonicalRecipient, isOwnRecipient } from './recipientAddress';

describe('canonicalRecipient', () => {
	it('matches the platform vectors', () => {
		expect(vectors.length).toBeGreaterThan(0);
		for (const v of vectors) {
			expect(canonicalRecipient(v.input), v.input).toBe(v.canonical);
		}
	});

	it('is idempotent', () => {
		for (const v of vectors) {
			const once = canonicalRecipient(v.input);
			expect(canonicalRecipient(once), v.input).toBe(once);
		}
	});
});

describe('isOwnRecipient', () => {
	const mine = ['vlad@thelemail.com', 'Support@Company.com'];

	it('matches own addresses with and without tags', () => {
		expect(isOwnRecipient('vlad@thelemail.com', mine)).toBe(true);
		expect(isOwnRecipient('VLAD+shop@thelemail.com', mine)).toBe(true);
		expect(isOwnRecipient('support+billing@company.com', mine)).toBe(true);
	});

	it('does not match other people or other domains', () => {
		expect(isOwnRecipient('vlad@gmail.com', mine)).toBe(false);
		expect(isOwnRecipient('vlad+x@gmail.com', mine)).toBe(false);
		expect(isOwnRecipient('vladx@thelemail.com', mine)).toBe(false);
		expect(isOwnRecipient('+vlad@thelemail.com', mine)).toBe(false);
	});
});
