import type { SigningDelegation } from '$core/api/delegations';

export type DelegationStatus = 'active' | 'expired' | 'revoked';

export function delegationStatus(
	d: Pick<SigningDelegation, 'revokedAt' | 'notAfter'>,
	now: number
): DelegationStatus {
	if (d.revokedAt) return 'revoked';
	if (Date.parse(d.notAfter) <= now) return 'expired';
	return 'active';
}
