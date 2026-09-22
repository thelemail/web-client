import { ApiCallError } from '$core/api/types';
import { timeUntil } from '$core/i18n/relative';
import { isReadOnlyError, isUpgradeRequiredError, readOnlyMessage } from '$core/lifecycle/errors';
import { m } from '$paraglide/messages.js';

const DEFAULT_RETRY_SECONDS = 60;

function retryWhen(err: ApiCallError, now: number): string {
	const seconds = err.envelope?.error?.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS;
	return timeUntil(now + seconds * 1000, now);
}

function isPaymentRequiredError(err: unknown): boolean {
	return err instanceof ApiCallError && err.envelope?.error?.code === 'payment_required';
}

export function checkErrorMessage(err: unknown, now: number): string | null {
	if (err instanceof ApiCallError && err.status === 409) return null;
	if (isUpgradeRequiredError(err) || isPaymentRequiredError(err)) return m.settings_domains_nudge_title();
	if (isReadOnlyError(err)) return readOnlyMessage();
	if (err instanceof ApiCallError && err.status === 429)
		return m.settings_domains_check_rate_limited({ when: retryWhen(err, now) });
	return m.settings_domains_wizard_check_failed();
}
