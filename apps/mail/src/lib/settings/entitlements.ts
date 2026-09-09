import type { PlanCode } from '$lib/api/billing';
import type { WorkspaceType } from '$lib/api/workspaces';

export const SHARED_DOMAIN = 'thelemail.com';

const FREE_CODES: PlanCode[] = ['free', 'free_family'];
const SOLO_CODES: PlanCode[] = ['free', 'personal', 'personal_plus'];

export type InviteMode = 'none' | 'domain' | 'existing-account';

export function isFreePlan(code: PlanCode | null | undefined): boolean {
	return !!code && FREE_CODES.includes(code);
}

export function isFreeFamily(code: PlanCode | null | undefined): boolean {
	return code === 'free_family';
}

export function allowsCustomDomains(code: PlanCode | null | undefined): boolean {
	return !!code && !isFreePlan(code);
}

export function allowsSharedAddresses(code: PlanCode | null | undefined): boolean {
	return !!code && (!isFreePlan(code) || allowsSharedDomainAlias(code));
}

export function allowsSharedDomainAlias(code: PlanCode | null | undefined): boolean {
	return !!code && !SOLO_CODES.includes(code);
}

export function allowsMembers(code: PlanCode | null | undefined): boolean {
	return !!code && code !== 'free';
}

export function inviteMode(
	type: WorkspaceType | null | undefined,
	code: PlanCode | null | undefined
): InviteMode {
	if (type !== 'family' && type !== 'business') return 'none';
	if (!allowsMembers(code)) return 'none';
	return isFreeFamily(code) ? 'existing-account' : 'domain';
}

export function isSharedDomainAddress(email: string): boolean {
	const at = email.lastIndexOf('@');
	if (at < 0) return false;
	return email.slice(at + 1).toLowerCase() === SHARED_DOMAIN;
}
