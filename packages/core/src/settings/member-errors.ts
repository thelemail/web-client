import { m } from '$paraglide/messages.js';
import { ApiCallError, type ErrorCode } from '$core/api/types';

export type MemberActionKind = 'promote' | 'demote' | 'remove' | 'revoke' | 'resend';

type Overrides = Partial<Record<ErrorCode, () => string>>;

function errorCode(err: unknown): ErrorCode | null {
	return err instanceof ApiCallError ? (err.envelope?.error?.code ?? null) : null;
}

export function workspaceErrorText(err: unknown, fallback: () => string, overrides: Overrides = {}): string {
	const code = errorCode(err);
	if (code && overrides[code]) return overrides[code]();
	switch (code) {
		case 'rate_limited':
			return m.settings_member_err_rate_limited();
		case 'forbidden':
			return m.settings_member_err_forbidden();
		case 'not_found':
			return m.settings_member_err_not_found();
		case 'conflict':
			return m.settings_member_err_conflict();
		default:
			return fallback();
	}
}

export function memberActionError(err: unknown, kind: MemberActionKind, name: string): string {
	switch (kind) {
		case 'resend':
			return workspaceErrorText(err, m.settings_member_err_resend, {
				rate_limited: m.settings_member_err_resend_too_soon,
				unsupported_parameters: m.settings_member_err_resend_no_email
			});
		case 'revoke':
			return workspaceErrorText(err, m.settings_member_err_revoke, {
				conflict: m.settings_member_err_invite_settled
			});
		case 'remove':
			return workspaceErrorText(err, () => m.settings_member_err_remove({ name }));
		case 'promote':
			return workspaceErrorText(err, () => m.settings_member_err_promote({ name }));
		case 'demote':
			return workspaceErrorText(err, () => m.settings_member_err_demote({ name }));
	}
}
