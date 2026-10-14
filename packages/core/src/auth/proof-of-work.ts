import { registrationChallenge } from '$core/api/auth';
import { ApiCallError, type ProofChallenge } from '$core/api/types';

const RENEW_MARGIN_MS = 60_000;
const RETRYABLE = new Set(['proof_invalid', 'proof_expired', 'proof_reused']);
const RESTARTABLE = new Set(['proof_required', 'proof_expired']);

export type ProofSolver = (challenge: ProofChallenge, signal: AbortSignal) => Promise<string>;

interface SolvedProof {
	payload: string;
	expiresAt: number;
}

export interface ProofOfWorkOptions {
	fetchChallenge?: () => Promise<ProofChallenge>;
	solve?: ProofSolver;
	now?: () => number;
}

export interface ProofOfWork {
	prepare(): void;
	take(): Promise<string>;
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

export async function withProofOfWork<T>(
	proof: ProofOfWork,
	run: (payload: string) => Promise<T>
): Promise<T> {
	try {
		return await run(await proof.take());
	} catch (err) {
		if (!isRetryableProofError(err)) throw err;
		return run(await proof.take());
	}
}
