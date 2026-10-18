export const RETIRED_KEY_SKEW_MS = 5 * 60 * 1000;

export function signedWhileCurrent(signedAtMillis: number | undefined, retiredAtMillis: number): boolean {
	return typeof signedAtMillis === 'number' && signedAtMillis < retiredAtMillis + RETIRED_KEY_SKEW_MS;
}
