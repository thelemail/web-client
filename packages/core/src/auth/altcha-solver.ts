import { solveChallengeWorkers } from 'altcha/lib';
import Pbkdf2Worker from 'altcha/workers/pbkdf2?worker';
import type { ProofChallenge } from '$core/api/types';
import { m } from '$paraglide/messages.js';

const ALGORITHM = 'PBKDF2/SHA-256';
const MAX_WORKERS = 8;

export class ProofSolveError extends Error {
	constructor(cause?: unknown) {
		super(m.auth_proof_failed(), { cause });
		this.name = 'ProofSolveError';
	}
}

interface ProofSolution {
	counter: number;
	derivedKey: string;
	time?: number;
}

export function encodeProof(challenge: ProofChallenge, solution: ProofSolution): string {
	return btoa(
		JSON.stringify({
			challenge: { parameters: challenge.parameters, signature: challenge.signature },
			solution
		})
	);
}

export async function solveWithAltcha(
	challenge: ProofChallenge,
	signal: AbortSignal
): Promise<string> {
	signal.throwIfAborted();
	if (challenge.parameters.algorithm !== ALGORITHM) throw new ProofSolveError();
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal.addEventListener('abort', abort, { once: true });
	try {
		const solution = await solveChallengeWorkers({
			challenge,
			controller,
			concurrency: Math.min(MAX_WORKERS, Math.max(1, navigator.hardwareConcurrency || 1)),
			createWorker: () => new Pbkdf2Worker(),
			counterMode: 'uint32'
		});
		signal.throwIfAborted();
		if (!solution) throw new ProofSolveError();
		return encodeProof(challenge, solution);
	} catch (err) {
		if (signal.aborted || err instanceof ProofSolveError) throw err;
		throw new ProofSolveError(err);
	} finally {
		signal.removeEventListener('abort', abort);
	}
}
