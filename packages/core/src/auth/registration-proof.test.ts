import { describe, expect, it, vi } from 'vitest';
import { ApiCallError, type ErrorCode, type RegistrationChallenge } from '$core/api/types';
import {
	createRegistrationProof,
	isRetryableProofError,
	withRegistrationProof,
	type ProofSolver
} from './registration-proof';

const NOW = 1_900_000_000_000;

function challenge(id: number, expiresInMs = 600_000): RegistrationChallenge {
	return {
		parameters: {
			algorithm: 'PBKDF2/SHA-256',
			nonce: `nonce-${id}`,
			salt: 'salt',
			cost: 10,
			keyLength: 32,
			keyPrefix: '00',
			expiresAt: Math.floor((NOW + expiresInMs) / 1000)
		},
		signature: `sig-${id}`
	};
}

function rejection(code: ErrorCode, status = 422) {
	return new ApiCallError(status, { error: { code, message: code } }, code);
}

function harness(expiries: number[] = []) {
	let issued = 0;
	const fetchChallenge = vi.fn(async () => {
		issued += 1;
		return challenge(issued, expiries[issued - 1]);
	});
	const solve = vi.fn<ProofSolver>(async (c) => `proof:${c.signature}`);
	const proof = createRegistrationProof({ fetchChallenge, solve, now: () => NOW });
	return { proof, fetchChallenge, solve };
}

describe('createRegistrationProof', () => {
	it('solves ahead of time and hands the prepared proof out once', async () => {
		const { proof, fetchChallenge } = harness();
		proof.prepare();
		proof.prepare();
		expect(await proof.take()).toBe('proof:sig-1');
		expect(fetchChallenge).toHaveBeenCalledTimes(1);
		expect(await proof.take()).toBe('proof:sig-2');
	});

	it('solves on demand without prepare', async () => {
		const { proof, solve } = harness();
		expect(await proof.take()).toBe('proof:sig-1');
		expect(solve).toHaveBeenCalledTimes(1);
	});

	it('replaces a prepared proof that is about to expire', async () => {
		const { proof, fetchChallenge } = harness([30_000]);
		proof.prepare();
		expect(await proof.take()).toBe('proof:sig-2');
		expect(fetchChallenge).toHaveBeenCalledTimes(2);
	});

	it('recovers when the prepared attempt failed', async () => {
		const { proof, fetchChallenge } = harness();
		fetchChallenge.mockRejectedValueOnce(new Error('offline'));
		proof.prepare();
		await Promise.resolve();
		expect(await proof.take()).toBe('proof:sig-1');
	});

	it('surfaces a solver failure on take', async () => {
		const { proof, solve } = harness();
		solve.mockRejectedValue(new Error('no solution'));
		await expect(proof.take()).rejects.toThrow('no solution');
	});

	it('aborts in-flight work on dispose', async () => {
		let seen: AbortSignal | undefined;
		const proof = createRegistrationProof({
			fetchChallenge: async () => challenge(1),
			solve: (_c, signal) => {
				seen = signal;
				return new Promise((_resolve, reject) =>
					signal.addEventListener('abort', () => reject(signal.reason))
				);
			},
			now: () => NOW
		});
		proof.prepare();
		await vi.waitFor(() => expect(seen).toBeDefined());
		proof.dispose();
		expect(seen?.aborted).toBe(true);
	});
});

describe('withRegistrationProof', () => {
	it.each(['proof_expired', 'proof_reused', 'proof_invalid'] as const)(
		'retries once with a fresh proof after %s',
		async (code) => {
			const { proof } = harness();
			const run = vi
				.fn<(payload: string) => Promise<string>>()
				.mockRejectedValueOnce(rejection(code))
				.mockResolvedValueOnce('ok');
			expect(await withRegistrationProof(proof, run)).toBe('ok');
			expect(run.mock.calls).toEqual([['proof:sig-1'], ['proof:sig-2']]);
		}
	);

	it('gives up after the second rejection', async () => {
		const { proof } = harness();
		const run = vi.fn(async () => {
			throw rejection('proof_expired');
		});
		await expect(withRegistrationProof(proof, run)).rejects.toBeInstanceOf(ApiCallError);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('does not retry unrelated failures', async () => {
		const { proof } = harness();
		const run = vi.fn(async () => {
			throw rejection('rate_limited', 429);
		});
		await expect(withRegistrationProof(proof, run)).rejects.toBeInstanceOf(ApiCallError);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('does not retry a request the server says needs an update', () => {
		expect(isRetryableProofError(rejection('proof_required'))).toBe(false);
	});
});
