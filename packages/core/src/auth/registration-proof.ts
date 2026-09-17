import { registrationChallenge } from '$core/api/auth';
import { ApiCallError, type RegistrationChallenge } from '$core/api/types';

const RENEW_MARGIN_MS = 60_000;
const RETRYABLE = new Set(['proof_invalid', 'proof_expired', 'proof_reused']);

export type ProofSolver = (challenge: RegistrationChallenge, signal: AbortSignal) => Promise<string>;

interface SolvedProof {
	payload: string;
	expiresAt: number;
}

export interface RegistrationProofOptions {
	fetchChallenge?: () => Promise<RegistrationChallenge>;
	solve?: ProofSolver;
	now?: () => number;
}

export interface RegistrationProof {
	prepare(): void;
	take(): Promise<string>;
	dispose(): void;
}

async function solveWithWidget(challenge: RegistrationChallenge, signal: AbortSignal) {
	const { solveWithAltcha } = await import('./altcha-solver');
	return solveWithAltcha(challenge, signal);
}

export function isRetryableProofError(err: unknown): boolean {
	return (
		err instanceof ApiCallError &&
		err.status === 422 &&
		RETRYABLE.has(err.envelope?.error.code ?? '')
	);
}

export function createRegistrationProof({
	fetchChallenge = registrationChallenge,
	solve = solveWithWidget,
	now = Date.now
}: RegistrationProofOptions = {}): RegistrationProof {
	let controller = new AbortController();
	let ready: Promise<SolvedProof> | null = null;

	function solveFresh(): Promise<SolvedProof> {
		const { signal } = controller;
		const run = (async () => {
			const challenge = await fetchChallenge();
			signal.throwIfAborted();
			const payload = await solve(challenge, signal);
			signal.throwIfAborted();
			return { payload, expiresAt: challenge.parameters.expiresAt * 1000 };
		})();
		run.catch(() => {
			if (ready === run) ready = null;
		});
		return run;
	}

	async function claim(): Promise<SolvedProof> {
		const pending = ready;
		ready = null;
		if (pending) {
			try {
				return await pending;
			} catch (err) {
				if (controller.signal.aborted) throw err;
			}
		}
		return solveFresh();
	}

	return {
		prepare() {
			if (!ready) ready = solveFresh();
		},
		async take() {
			let proof = await claim();
			if (proof.expiresAt - now() < RENEW_MARGIN_MS) {
				proof = await solveFresh();
			}
			return proof.payload;
		},
		dispose() {
			controller.abort();
			controller = new AbortController();
			ready = null;
		}
	};
}

export async function withRegistrationProof<T>(
	proof: RegistrationProof,
	run: (payload: string) => Promise<T>
): Promise<T> {
	try {
		return await run(await proof.take());
	} catch (err) {
		if (!isRetryableProofError(err)) throw err;
		return run(await proof.take());
	}
}
