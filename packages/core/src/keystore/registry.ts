import type { CounterName, KeyUse, ProfileId } from '../interop/generated/profile-ids';
import { COUNTERS, LIMITS, MAX_COUNTER } from '../interop/generated/profile-ids';
import type { Profile } from '../interop/generated/profiles';
import { PROFILES } from '../interop/generated/profiles';
import { isProfileId } from './profileIds';

export type { CounterName, KeyUse, Profile, ProfileId };
export { COUNTERS, LIMITS, MAX_COUNTER, PROFILES };
export { checkCounter, CounterError, isCounterName, isLegacyImportFormat, isProfileId, nextCounter } from './profileIds';

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

export function convertsTo(from: string, to: string): boolean {
	return lookupProfile(from)?.conversionEdges.includes(to as ProfileId) ?? false;
}
