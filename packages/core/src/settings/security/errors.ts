import { ApiCallError } from '$core/api/types';
import { m } from '$paraglide/messages.js';

export function securityActionError(err: unknown, fallback: () => string): string {
	if (err instanceof ApiCallError && err.status === 429) return m.settings_security_rate_limited();
	return fallback();
}
