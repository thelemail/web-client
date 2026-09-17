import 'altcha/external';
import Pbkdf2Worker from 'altcha/workers/pbkdf2?worker';
import type { AltchaWidgetElement } from 'altcha/types/generic';
import type { RegistrationChallenge } from '$core/api/types';

const ALGORITHM = 'PBKDF2/SHA-256';
const MOUNT_ATTEMPTS = 50;

globalThis.$altcha.algorithms.set(ALGORITHM, () => new Pbkdf2Worker());

export class ProofSolveError extends Error {
	constructor(cause?: unknown) {
		super('We couldn’t verify this device. Try again.', { cause });
		this.name = 'ProofSolveError';
	}
}

async function mounted(widget: AltchaWidgetElement) {
	for (let attempt = 0; attempt < MOUNT_ATTEMPTS; attempt++) {
		if (typeof widget.configure === 'function' && typeof widget.verify === 'function') return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new ProofSolveError();
}

export async function solveWithAltcha(
	challenge: RegistrationChallenge,
	signal: AbortSignal
): Promise<string> {
	signal.throwIfAborted();
	if (challenge.parameters.algorithm !== ALGORITHM) throw new ProofSolveError();
	const widget = document.createElement('altcha-widget');
	widget.hidden = true;
	document.body.append(widget);
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal.addEventListener('abort', abort, { once: true });
	try {
		await mounted(widget);
		await widget.configure({
			challenge,
			auto: 'off',
			display: 'invisible',
			hideLogo: true,
			hideFooter: true,
			humanInteractionSignature: false,
			minDuration: 0
		});
		const result = await widget.verify({ controller });
		signal.throwIfAborted();
		if (!result?.payload) throw new ProofSolveError(widget.getState());
		return result.payload;
	} catch (err) {
		if (signal.aborted || err instanceof ProofSolveError) throw err;
		throw new ProofSolveError(err);
	} finally {
		signal.removeEventListener('abort', abort);
		widget.remove();
	}
}
