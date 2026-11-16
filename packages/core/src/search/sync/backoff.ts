export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_CAP_MS = 60_000;

export function backoffDelay(attempt: number, retryAfterSeconds: number | null, random: () => number = Math.random): number {
	if (retryAfterSeconds !== null && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
	const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
	return Math.floor(random() * ceiling);
}
