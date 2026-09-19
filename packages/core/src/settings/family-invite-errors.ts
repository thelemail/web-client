import { m } from '$paraglide/messages.js';
import { ApiCallError } from '$core/api/types';
import { SHARED_DOMAIN } from './entitlements';

export function familyInviteError(err: unknown, email: string): string {
	const code = err instanceof ApiCallError ? err.envelope?.error?.code : null;
	switch (code) {
		case 'invitee_not_found':
			return m.settings_family_invite_err_not_found({ email });
		case 'invitee_plan_conflict':
			return m.settings_family_invite_err_plan_conflict({ email });
		case 'invitee_store_billed':
			return m.settings_family_invite_err_store_billed({ email });
		case 'invitee_already_in_family':
			return m.settings_family_invite_err_already_in_family({ email });
		case 'invitee_has_custom_domain':
			return m.settings_family_invite_err_custom_domain({ email });
		case 'invitee_domain_not_shared':
			return m.settings_family_invite_err_domain_not_shared({ email, domain: SHARED_DOMAIN });
		case 'family_full':
			return m.settings_family_invite_err_full();
		case 'rate_limited':
			return m.settings_family_invite_err_rate_limited();
		case 'conflict':
			return m.settings_family_invite_err_conflict({ email });
		default:
			return m.settings_family_invite_err_default();
	}
}

export function acceptInviteError(err: unknown, inviterName: string): string {
	const who = inviterName.trim() || m.settings_family_accept_whoever();
	const code = err instanceof ApiCallError ? err.envelope?.error?.code : null;
	switch (code) {
		case 'family_full':
			return m.settings_family_accept_err_full({ who });
		case 'invite_not_acceptable':
			return m.settings_family_accept_err_not_acceptable();
		case 'invitee_plan_conflict':
			return m.settings_family_accept_err_plan_conflict();
		case 'invitee_store_billed':
			return m.settings_family_accept_err_store_billed();
		case 'invitee_has_custom_domain':
			return m.settings_family_accept_err_custom_domain();
		case 'invitee_already_in_family':
			return m.settings_family_accept_err_already_in_family();
		case 'not_found':
			return m.settings_family_accept_err_not_found({ who });
		case 'rate_limited':
			return m.settings_family_accept_err_rate_limited();
		default:
			return m.settings_family_accept_err_default();
	}
}
