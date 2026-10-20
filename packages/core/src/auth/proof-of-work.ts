import { registrationChallenge } from '$core/api/auth';
import { ApiCallError, type ProofChallenge } from '$core/api/types';

const RENEW_MARGIN_MS = 20_000;
const RETRYABLE = new Set(['proof_invalid', 'proof_expired', 'proof_reused']);
const RESTARTABLE = new Set(['proof_required', 'proof_expired']);

export type ProofSolver = (challenge: ProofChallenge, signal: AbortSignal) => Promise<string>;

interface SolvedProof {
	payload: string;
	expiresAt: number;
}

interface PendingProof {
	email: string;
	run: Promise<SolvedProof>;
}

export interface ProofOfWorkOptions {
	fetchChallenge?: (email: string) => Promise<ProofChallenge>;
	solve?: ProofSolver;
	now?: () => number;
}

export interface ProofOfWork {
	prepare(email: string): void;
	take(email: string): Promise<string>;
	dispose(): void;
}

export async function solveProof(challenge: ProofChallenge, signal: AbortSignal): Promise<string> {
	const { solveWithAltcha } = await import('./altcha-solver');
	return solveWithAltcha(challenge, signal);
}

function hasProofCode(err: unknown, codes: Set<string>): boolean {
	return err instanceof ApiCallError && err.status === 422 && codes.has(err.envelope?.error.code ?? '');
}

export function isRetryableProofError(err: unknown): boolean {
	return hasProofCode(err, RETRYABLE);
}

export function isRestartableLoginProofError(err: unknown): boolean {
	return hasProofCode(err, RESTARTABLE);
}

export function createProofOfWork({
	fetchChallenge = registrationChallenge,
	solve = solveProof,
	now = Date.now
}: ProofOfWorkOptions = {}): ProofOfWork {
	let controller = new AbortController();
	let ready: PendingProof | null = null;

	function reset() {
		controller.abort();
		controller = new AbortController();
		ready = null;
	}

	function solveFresh(email: string): PendingProof {
		const { signal } = controller;
		const run = (async () => {
			const challenge = await fetchChallenge(email);
			signal.throwIfAborted();
			const payload = await solve(challenge, signal);
			signal.throwIfAborted();
			return { payload, expiresAt: challenge.parameters.expiresAt * 1000 };
		})();
		const pending = { email, run };
		run.catch(() => {
			if (ready === pending) ready = null;
		});
		return pending;
	}

	async function claim(email: string): Promise<SolvedProof> {
		const pending = ready;
		ready = null;
		if (pending?.email === email) {
			try {
				return await pending.run;
			} catch (err) {
				if (controller.signal.aborted) throw err;
			}
		} else if (pending) {
			reset();
		}
		return solveFresh(email).run;
	}

	return {
		prepare(email) {
			if (ready?.email === email) return;
			if (ready) reset();
			ready = solveFresh(email);
		},
		async take(email) {
			let proof = await claim(email);
			if (proof.expiresAt - now() < RENEW_MARGIN_MS) {
				proof = await solveFresh(email).run;
			}
			return proof.payload;
		},
		dispose: reset
	};
}

export async function withProofOfWork<T>(
	proof: ProofOfWork,
	email: string,
	run: (payload: string) => Promise<T>
): Promise<T> {
	try {
		return await run(await proof.take(email));
	} catch (err) {
		if (!isRetryableProofError(err)) throw err;
		return run(await proof.take(email));
	}
}
