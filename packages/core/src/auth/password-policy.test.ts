import { describe, expect, it } from 'vitest';
import list from './common-passwords.txt?raw';
import vectors from './fixtures/password_policy_vectors.json';
import { PASSWORD_MIN_LENGTH, isCommonPassword, passwordLength, passwordReqs } from './password-policy';

function verdict(p: string) {
	const reqs = passwordReqs(p);
	const met = (k: string) => reqs.find((r) => r.k === k)?.met;
	return { long_enough: met('len'), not_common: met('common'), accepted: reqs.every((r) => r.met) };
}

describe('password policy', () => {
	it('matches the shared vectors', () => {
		expect(vectors.length).toBeGreaterThan(0);
		for (const v of vectors) {
			expect(verdict(v.password), JSON.stringify(v.password)).toEqual({
				long_enough: v.long_enough,
				not_common: v.not_common,
				accepted: v.accepted
			});
		}
	});

	it('has no composition rule', () => {
		expect(passwordReqs('a'.repeat(PASSWORD_MIN_LENGTH)).map((r) => r.k)).toEqual(['len', 'common']);
		expect(verdict('lowercase only words').accepted).toBe(true);
		expect(verdict('0'.repeat(PASSWORD_MIN_LENGTH) + '7').accepted).toBe(true);
	});

	it('rejects common passwords regardless of case', () => {
		expect(isCommonPassword('password1234')).toBe(true);
		expect(isCommonPassword('PASSWORD1234')).toBe(true);
		expect(verdict('Password1234').accepted).toBe(false);
	});

	it('accepts long passwords', () => {
		expect(verdict('k'.repeat(64)).accepted).toBe(true);
		expect(verdict('long passphrase '.repeat(32)).accepted).toBe(true);
	});

	it('counts code points, not UTF-16 units', () => {
		expect(passwordLength('🔑'.repeat(11))).toBe(11);
		expect(verdict('🔑'.repeat(11)).long_enough).toBe(false);
	});

	it('ships a normalised list', () => {
		const entries = list.split('\n').filter(Boolean);
		expect(entries.length).toBeGreaterThan(1000);
		expect(new Set(entries).size).toBe(entries.length);
		for (const e of entries) {
			expect(e).toBe(e.toLowerCase());
			expect(passwordLength(e)).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
		}
	});
});
