import { describe, expect, it, vi } from 'vitest';
import { ApiCallError, type ErrorCode, type ProofChallenge } from '$core/api/types';
import {
	createProofOfWork,
	isRetryableProofError,
	withProofOfWork,
	type ProofSolver
} from './proof-of-work';

const NOW = 1_900_000_000_000;
const EMAIL = 'new.user@temail.org';

function challenge(id: number, expiresInMs = 120_000): ProofChallenge {
	return {
		parameters: {
			algorithm: 'PBKDF2/SHA-256',
			nonce: `nonce-${id}`,
			salt: 'salt',
			cost: 10,
			keyLength: 32,
			keyPrefix: '00',
			expiresAt: Math.floor((NOW + expiresInMs) / 1000),
			data: { p: 'registration' }
		},
		signature: `sig-${id}`
	};
}

function rejection(code: ErrorCode, status = 422) {
	return new ApiCallError(status, { error: { code, message: code } }, code);
}

function harness(expiries: number[] = []) {
	let issued = 0;
	const fetchChallenge = vi.fn(async (_email: string) => {
		issued += 1;
		return challenge(issued, expiries[issued - 1]);
	});
	const solve = vi.fn<ProofSolver>(async (c) => `proof:${c.signature}`);
	const proof = createProofOfWork({ fetchChallenge, solve, now: () => NOW });
	return { proof, fetchChallenge, solve };
}

describe('createProofOfWork', () => {
	it('solves ahead of time and hands the prepared proof out once', async () => {
		const { proof, fetchChallenge } = harness();
		proof.prepare(EMAIL);
		proof.prepare(EMAIL);
		expect(await proof.take(EMAIL)).toBe('proof:sig-1');
		expect(fetchChallenge).toHaveBeenCalledTimes(1);
		expect(fetchChallenge).toHaveBeenCalledWith(EMAIL);
		expect(await proof.take(EMAIL)).toBe('proof:sig-2');
	});

	it('drops a proof prepared for another address', async () => {
		let seen: AbortSignal | undefined;
		const fetchChallenge = vi.fn(async (email: string) => ({ ...challenge(1), signature: `sig-${email}` }));
		const solve = vi.fn<ProofSolver>(async (c, signal) => {
			if (c.signature === 'sig-old@temail.org') {
				seen = signal;
				return new Promise((_resolve, reject) =>
					signal.addEventListener('abort', () => reject(signal.reason))
				);
			}
			return `proof:${c.signature}`;
		});
		const proof = createProofOfWork({ fetchChallenge, solve, now: () => NOW });
		proof.prepare('old@temail.org');
		await vi.waitFor(() => expect(seen).toBeDefined());
		proof.prepare(EMAIL);
		expect(seen?.aborted).toBe(true);
		expect(await proof.take(EMAIL)).toBe(`proof:sig-${EMAIL}`);
		expect(await proof.take('other@temail.org')).toBe('proof:sig-other@temail.org');
		expect(fetchChallenge.mock.calls).toEqual([['old@temail.org'], [EMAIL], ['other@temail.org']]);
	});

	it('solves on demand without prepare', async () => {
		const { proof, solve } = harness();
		expect(await proof.take(EMAIL)).toBe('proof:sig-1');
		expect(solve).toHaveBeenCalledTimes(1);
	});

	it('replaces a prepared proof that is about to expire', async () => {
		const { proof, fetchChallenge } = harness([10_000]);
		proof.prepare(EMAIL);
		expect(await proof.take(EMAIL)).toBe('proof:sig-2');
		expect(fetchChallenge).toHaveBeenCalledTimes(2);
	});

	it('recovers when the prepared attempt failed', async () => {
		const { proof, fetchChallenge } = harness();
		fetchChallenge.mockRejectedValueOnce(new Error('offline'));
		proof.prepare(EMAIL);
		await Promise.resolve();
		expect(await proof.take(EMAIL)).toBe('proof:sig-1');
	});

	it('surfaces a solver failure on take', async () => {
		const { proof, solve } = harness();
		solve.mockRejectedValue(new Error('no solution'));
		await expect(proof.take(EMAIL)).rejects.toThrow('no solution');
	});

	it('aborts in-flight work on dispose', async () => {
		let seen: AbortSignal | undefined;
		const proof = createProofOfWork({
			fetchChallenge: async () => challenge(1),
			solve: (_c, signal) => {
				seen = signal;
				return new Promise((_resolve, reject) =>
					signal.addEventListener('abort', () => reject(signal.reason))
				);
			},
			now: () => NOW
		});
		proof.prepare(EMAIL);
		await vi.waitFor(() => expect(seen).toBeDefined());
		proof.dispose();
		expect(seen?.aborted).toBe(true);
	});
});

describe('withProofOfWork', () => {
	it.each(['proof_expired', 'proof_reused', 'proof_invalid'] as const)(
		'retries once with a fresh proof after %s',
		async (code) => {
			const { proof } = harness();
			const run = vi
				.fn<(payload: string) => Promise<string>>()
				.mockRejectedValueOnce(rejection(code))
				.mockResolvedValueOnce('ok');
			expect(await withProofOfWork(proof, EMAIL, run)).toBe('ok');
			expect(run.mock.calls).toEqual([['proof:sig-1'], ['proof:sig-2']]);
		}
	);

	it('gives up after the second rejection', async () => {
		const { proof } = harness();
		const run = vi.fn(async () => {
			throw rejection('proof_expired');
		});
		await expect(withProofOfWork(proof, EMAIL, run)).rejects.toBeInstanceOf(ApiCallError);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('does not retry unrelated failures', async () => {
		const { proof } = harness();
		const run = vi.fn(async () => {
			throw rejection('rate_limited', 429);
		});
		await expect(withProofOfWork(proof, EMAIL, run)).rejects.toBeInstanceOf(ApiCallError);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('does not retry a request the server says needs an update', () => {
		expect(isRetryableProofError(rejection('proof_required'))).toBe(false);
	});
});
