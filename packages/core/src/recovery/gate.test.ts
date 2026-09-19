import { describe, expect, it } from 'vitest';
import { resolveReturnTo } from '$core/auth/return-to';
import { recoveryGateTarget } from './gate';

describe('recoveryGateTarget', () => {
	it('sends an account without recovery to the recovery page', () => {
		expect(recoveryGateTarget('/u/2/mail/inbox', '', 2, false)).toBe(
			'/u/2/recovery?redirect=%2Fu%2F2%2Fmail%2Finbox'
		);
	});

	it('keeps the deep link and its query for after setup', () => {
		const target = recoveryGateTarget('/u/0/settings/profile', '?tab=name', 0, false)!;
		const back = new URL(target, 'https://x').searchParams.get('redirect');
		expect(back).toBe('/u/0/settings/profile?tab=name');
		expect(resolveReturnTo(back, 0)).toBe('/u/0/settings/profile?tab=name');
	});

	it('leaves accounts with recovery alone', () => {
		expect(recoveryGateTarget('/u/1/mail/inbox', '', 1, true)).toBeNull();
		expect(recoveryGateTarget('/u/1/settings/security', '', 1, true)).toBeNull();
	});

	it('does not block when the profile is unknown', () => {
		expect(recoveryGateTarget('/u/1/mail/inbox', '', 1, null)).toBeNull();
	});

	it('lets billing, lifecycle and deletion screens through', () => {
		for (const path of [
			'/u/3/billing/choose',
			'/u/3/billing/return',
			'/u/3/lifecycle/suspended',
			'/u/3/deletion-pending',
			'/u/3/recovery'
		]) {
			expect(recoveryGateTarget(path, '', 3, false)).toBeNull();
		}
	});

	it('does not treat look-alike paths as exempt', () => {
		expect(recoveryGateTarget('/u/3/billingx', '', 3, false)).toBe(
			'/u/3/recovery?redirect=%2Fu%2F3%2Fbillingx'
		);
	});

	it('sends a finished account away from the recovery page', () => {
		expect(recoveryGateTarget('/u/5/recovery', '', 5, true)).toBe('/u/5/mail/inbox');
	});

	it('omits the redirect for the bare account root', () => {
		expect(recoveryGateTarget('/u/0', '', 0, false)).toBe('/u/0/recovery');
	});
});
