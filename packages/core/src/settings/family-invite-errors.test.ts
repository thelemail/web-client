import { describe, it, expect } from 'vitest';
import { ApiCallError, type ErrorCode } from '$core/api/types';
import { acceptInviteError, familyInviteError } from './family-invite-errors';

function apiError(code: ErrorCode): ApiCallError {
	return new ApiCallError(409, { error: { code, message: 'server text' } }, 'server text');
}

const CODES: ErrorCode[] = [
	'invitee_not_found',
	'invitee_plan_conflict',
	'invitee_store_billed',
	'invitee_already_in_family',
	'invitee_has_custom_domain',
	'invitee_domain_not_shared',
	'family_full',
	'rate_limited',
	'conflict'
];

describe('familyInviteError', () => {
	it('names the seat limit the plan allows', () => {
		expect(familyInviteError(apiError('family_full'), 'a@b.com', 4)).toMatch(/4 accounts/);
		const unknown = familyInviteError(apiError('family_full'), 'a@b.com', null);
		expect(unknown).toMatch(/family is full/);
		expect(unknown).not.toMatch(/null|undefined|\d/);
	});

	it('has copy for every eligibility failure the API can return', () => {
		for (const code of CODES) {
			const msg = familyInviteError(apiError(code), 'anna@thelemail.com', 6);
			expect(msg).not.toMatch(/undefined/);
			expect(msg.length).toBeGreaterThan(20);
			expect(msg).not.toBe('Could not send the invitation. Try again.');
		}
	});

	it('explains an invitation the server refused as a conflict', () => {
		expect(familyInviteError(apiError('conflict'), 'anna@thelemail.com', 6)).toContain(
			'anna@thelemail.com'
		);
	});

	it('names the person in the message where it helps', () => {
		expect(familyInviteError(apiError('invitee_not_found'), 'anna@thelemail.com', 6)).toContain(
			'anna@thelemail.com'
		);
	});

	it('tells a paid invitee who cancels and that nothing is refunded', () => {
		const msg = familyInviteError(apiError('invitee_plan_conflict'), 'anna@thelemail.com', 6);
		expect(msg).toMatch(/themselves/);
		expect(msg).toMatch(/Account & plan/);
		expect(msg).toMatch(/not refund/);
	});

	it('sends store subscribers to the store', () => {
		expect(familyInviteError(apiError('invitee_store_billed'), 'a@b.com', 6)).toMatch(/App Store/);
	});

	it('falls back sanely on an unknown or non-API error', () => {
		expect(familyInviteError(new Error('boom'), 'a@b.com', 6)).toBe(
			'Could not send the invitation. Try again.'
		);
		expect(familyInviteError(null, 'a@b.com', 6)).not.toMatch(/undefined/);
	});
});

describe('acceptInviteError', () => {
	it('covers the failures the accept endpoint returns', () => {
		for (const code of [
			'family_full',
			'invite_not_acceptable',
			'not_found',
			'rate_limited'
		] as ErrorCode[]) {
			const msg = acceptInviteError(apiError(code), 'Marco');
			expect(msg).not.toBe('Could not join just now. Try again.');
			expect(msg).not.toMatch(/undefined/);
		}
	});

	it('names the lockout rather than a generic failure', () => {
		expect(acceptInviteError(apiError('rate_limited'), 'Marco')).toMatch(/too many failed attempts/i);
	});

	it('copes with a nameless inviter', () => {
		expect(acceptInviteError(apiError('not_found'), '')).toMatch(/whoever invited you/);
	});
});
