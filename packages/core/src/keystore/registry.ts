import type { CounterName, KeyUse, Profile, ProfileId } from '../interop/generated/profiles';
import { COUNTERS, LEGACY_IMPORT_PREFIX, LIMITS, MAX_COUNTER, PROFILES } from '../interop/generated/profiles';

export type { CounterName, KeyUse, Profile, ProfileId };
export { COUNTERS, LIMITS, MAX_COUNTER, PROFILES };

export class CounterError extends Error {
	constructor() {
		super('counter: value is outside 0 through 2^53-1');
		this.name = 'CounterError';
	}
}

export function isProfileId(id: string): id is ProfileId {
	return Object.hasOwn(PROFILES, id);
}

export function lookupProfile(id: string): Profile | undefined {
	return isProfileId(id) ? PROFILES[id] : undefined;
}

export function canCreate(id: string): boolean {
	const p = lookupProfile(id);
	return p !== undefined && p.status === 'admitted' && p.permissions.create;
}

export function canDecrypt(id: string): boolean {
	const p = lookupProfile(id);
	return p !== undefined && p.status !== 'recognized' && p.permissions.decrypt;
}

export function canVerify(id: string): boolean {
	const p = lookupProfile(id);
	return p !== undefined && p.status !== 'recognized' && p.permissions.verify;
}

export function admits(id: string, use: KeyUse): boolean {
	const p = lookupProfile(id);
	return p !== undefined && p.status === 'admitted' && p.keyUses.includes(use);
}

export function isLegacyImport(id: string): boolean {
	return lookupProfile(id)?.status === 'legacy-import';
}

export function isLegacyImportFormat(id: string): boolean {
	return id.length > LEGACY_IMPORT_PREFIX.length && id.length <= LIMITS.maxProfileIdBytes && id.startsWith(LEGACY_IMPORT_PREFIX);
}

export function convertsTo(from: string, to: string): boolean {
	return lookupProfile(from)?.conversionEdges.includes(to as ProfileId) ?? false;
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
