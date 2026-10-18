export const RETIRED_KEY_SKEW_MS = 5 * 60 * 1000;

export function beforeRetirement(millis: number | undefined, retiredAtMillis: number): boolean {
	return typeof millis === 'number' && Number.isFinite(millis) && millis < retiredAtMillis + RETIRED_KEY_SKEW_MS;
}

export function signedWhileCurrent(
	serverMillis: number | undefined,
	signedAtMillis: number | undefined,
	retiredAtMillis: number
): boolean {
	return beforeRetirement(serverMillis, retiredAtMillis) && beforeRetirement(signedAtMillis, retiredAtMillis);
}
