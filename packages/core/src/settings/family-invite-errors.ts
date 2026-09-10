import { ApiCallError } from '$core/api/types';
import { SHARED_DOMAIN } from './entitlements';

export function familyInviteError(err: unknown, email: string): string {
	const code = err instanceof ApiCallError ? err.envelope?.error?.code : null;
	switch (code) {
		case 'invitee_not_found':
			return `There is no Thelemail account at ${email}. They need to create one first, then you can invite them.`;
		case 'invitee_plan_conflict':
			return `${email} is on a paid plan. Joining a family would not refund it, so we leave the subscription alone. They can cancel it themselves under Account & plan, and you can invite them again once it ends.`;
		case 'invitee_store_billed':
			return `${email} pays through the App Store or Google Play. Those subscriptions have to be cancelled in the store, and they can be invited once it ends.`;
		case 'invitee_already_in_family':
			return `${email} is already in another family or team. They have to leave that one first.`;
		case 'invitee_has_custom_domain':
			return `${email} has a custom domain set up. A free family has no custom domains, so the domain has to go before they can join.`;
		case 'invitee_domain_not_shared':
			return `${email} is not a ${SHARED_DOMAIN} address. Only ${SHARED_DOMAIN} accounts can join a free family.`;
		case 'family_full':
			return 'Your family is full. Six accounts including yours is the limit, so remove someone before inviting anyone else.';
		case 'rate_limited':
			return 'That is a lot of invitations at once. Try again a little later.';
		case 'conflict':
			return `Cannot invite ${email} right now. They may already have an invitation waiting.`;
		default:
			return 'Could not send the invitation. Try again.';
	}
}

export function acceptInviteError(err: unknown, inviterName: string): string {
	const who = inviterName.trim() || 'whoever invited you';
	const code = err instanceof ApiCallError ? err.envelope?.error?.code : null;
	switch (code) {
		case 'family_full':
			return `That family is full now. Ask ${who} to make room and invite you again.`;
		case 'invite_not_acceptable':
			return 'This invitation is for a different account.';
		case 'invitee_plan_conflict':
			return 'You are on a paid plan. Cancel it under Account & plan, then accept this invitation once it ends.';
		case 'invitee_store_billed':
			return 'Your plan is billed by the App Store or Google Play. Cancel it there, then accept this invitation once it ends.';
		case 'invitee_has_custom_domain':
			return 'Your account has a custom domain. A free family has no custom domains, so the domain has to go before you can join.';
		case 'invitee_already_in_family':
			return 'Your account is already in a family or team. Leave that one first.';
		case 'not_found':
			return `This invitation is no longer valid. Ask ${who} to send a new one.`;
		case 'rate_limited':
			return 'Too many failed attempts on this invitation. Wait a while, then try again.';
		default:
			return 'Could not join just now. Try again.';
	}
}
