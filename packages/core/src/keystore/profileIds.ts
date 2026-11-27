import type { CounterName, ProfileId } from '../interop/generated/profile-ids';
import { COUNTERS, LEGACY_IMPORT_PREFIX, LIMITS, MAX_COUNTER, PROFILE_IDS } from '../interop/generated/profile-ids';

export class CounterError extends Error {
	constructor() {
		super('counter: value is outside 0 through 2^53-1');
		this.name = 'CounterError';
	}
}

export function isProfileId(id: string): id is ProfileId {
	return (PROFILE_IDS as readonly string[]).includes(id);
}

export function isLegacyImportFormat(id: string): boolean {
	return id.length > LEGACY_IMPORT_PREFIX.length && id.length <= LIMITS.maxProfileIdBytes && id.startsWith(LEGACY_IMPORT_PREFIX);
}

export function isCounterName(n: string): n is CounterName {
	return (COUNTERS as readonly string[]).includes(n);
}

export function checkCounter(v: number): number {
	if (!Number.isSafeInteger(v) || v < 0 || v > MAX_COUNTER) throw new CounterError();
	return v;
}

export function nextCounter(v: number): number {
	checkCounter(v);
	if (v === MAX_COUNTER) throw new CounterError();
	return v + 1;
}
