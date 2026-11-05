import { describe, expect, it } from 'vitest';
import { pbkdf2, solveChallenge, verifySolution } from 'altcha/lib';
import vectors from './fixtures/altcha_interop_vectors.json';

describe('altcha PBKDF2 solver', () => {
	it('finds the same solution as the platform for every vector', async () => {
		expect(vectors.length).toBeGreaterThan(0);
		expect(vectors.some((v) => 'data' in v.challenge.parameters)).toBe(true);
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

describe('altcha proof payload', () => {
	it('encodes the challenge and solution the way the platform decodes it', async () => {
		const { encodeProof } = await import('./altcha-solver');
		const v = vectors[0];
		const decoded = JSON.parse(
			atob(encodeProof(v.challenge as never, { counter: v.counter, derivedKey: v.derivedKey }))
		);
		expect(decoded.challenge.parameters).toEqual(v.challenge.parameters);
		expect(decoded.challenge.signature).toBe(v.challenge.signature);
		expect(decoded.solution).toEqual({ counter: v.counter, derivedKey: v.derivedKey });
	});
});
