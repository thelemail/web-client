import { ApiCallError } from '$lib/api/types';

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

export function isTrialLockedError(e: unknown): boolean {
	return (
		e instanceof ApiCallError && e.envelope?.error?.code === 'trial_feature_locked'
	);
}

export function trialLockedMessage(feature: string): string {
	return `${feature} isn't part of the free trial. Upgrade to a plan to unlock it.`;
}

export function readOnlyMessage(): string {
	return 'Sending and editing are paused. Restore your plan to continue.';
}

export function suspendedMessage(): string {
	return 'This account is suspended. Restore your plan to send and receive mail again.';
}
