export const RETIRED_KEY_SKEW_MS = 5 * 60 * 1000;

export function signedWhileCurrent(
	serverMillis: number | undefined,
	signedAtMillis: number | undefined,
	retiredAtMillis: number
): boolean {
	const limit = retiredAtMillis + RETIRED_KEY_SKEW_MS;
	return (
		typeof serverMillis === 'number' &&
		Number.isFinite(serverMillis) &&
		serverMillis < limit &&
		typeof signedAtMillis === 'number' &&
		signedAtMillis < limit
	);
}
