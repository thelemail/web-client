import { describe, expect, it } from 'vitest';
import { pbkdf2, solveChallenge, verifySolution } from 'altcha/lib';
import vectors from './fixtures/altcha_interop_vectors.json';

describe('altcha PBKDF2 solver', () => {
	it('finds the same solution as the platform for every vector', async () => {
		expect(vectors.length).toBeGreaterThan(0);
		for (const v of vectors) {
			const solution = await solveChallenge({ challenge: v.challenge, deriveKey: pbkdf2.deriveKey });
			expect(solution?.counter, v.challenge.parameters.nonce).toBe(v.counter);
			expect(solution?.derivedKey, v.challenge.parameters.nonce).toBe(v.derivedKey);
			const result = await verifySolution({
				challenge: v.challenge,
				solution: { counter: v.counter, derivedKey: v.derivedKey },
				deriveKey: pbkdf2.deriveKey,
				hmacSignatureSecret: v.hmacKey
			});
			expect(result.verified, v.challenge.parameters.nonce).toBe(true);
		}
	});
});
