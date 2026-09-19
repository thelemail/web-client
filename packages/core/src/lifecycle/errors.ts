import { ApiCallError } from '$core/api/types';
import { m } from '$paraglide/messages.js';

export function isReadOnlyError(e: unknown): boolean {
	return e instanceof ApiCallError && e.status === 403 && e.envelope?.error?.code === 'read_only';
}

export function isSuspendedError(e: unknown): boolean {
	return (
		e instanceof ApiCallError && e.status === 403 && e.envelope?.error?.code === 'account_suspended'
	);
}

export function isLifecycleError(e: unknown): boolean {
	return isReadOnlyError(e) || isSuspendedError(e);
}

export function isUpgradeRequiredError(e: unknown): boolean {
	return e instanceof ApiCallError && e.envelope?.error?.code === 'upgrade_required';
}

export function upgradeRequiredMessage(feature: string): string {
	return m.lc_error_upgrade_required({ feature });
}

export function readOnlyMessage(): string {
	return m.lc_error_read_only();
}

export function suspendedMessage(): string {
	return m.lc_error_suspended();
}
