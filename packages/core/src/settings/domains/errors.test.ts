import { describe, expect, it } from 'vitest';
import { ApiCallError, type ErrorCode } from '$core/api/types';
import { checkErrorMessage, createErrorMessage } from './errors';

const NOW = Date.parse('2026-09-22T12:00:00Z');

function apiError(status: number, code: ErrorCode, retryAfterSeconds?: number) {
	return new ApiCallError(status, { error: { code, message: 'raw server text', retryAfterSeconds } }, 'raw server text');
}

describe('checkErrorMessage', () => {
	it('stays quiet when the server refuses because the state moved on', () => {
		expect(checkErrorMessage(apiError(409, 'conflict'), NOW)).toBeNull();
	});

	it('says when checks can start again', () => {
		expect(checkErrorMessage(apiError(429, 'rate_limited', 600), NOW)).toBe(
			'Too many checks were started recently. Try again in 10 minutes.'
		);
	});

	it('waits a minute when the server gives no retry time', () => {
		expect(checkErrorMessage(apiError(429, 'rate_limited'), NOW)).toBe(
			'Too many checks were started recently. Try again in 1 minute.'
		);
	});

	it('names the plan when domains are not included', () => {
		expect(checkErrorMessage(apiError(403, 'upgrade_required'), NOW)).toBe(
			'Your own domain needs a paid plan'
		);
	});

	it('names the plan when the subscription lapsed', () => {
		expect(checkErrorMessage(apiError(402, 'payment_required'), NOW)).toBe(
			'Your own domain needs a paid plan'
		);
	});

	it('explains a read-only account', () => {
		expect(checkErrorMessage(apiError(403, 'read_only'), NOW)).toBe(
			'Sending and editing are paused. Restore your plan to continue.'
		);
	});

	it('falls back to a plain failure', () => {
		expect(checkErrorMessage(new Error('boom'), NOW)).toBe('Could not start the DNS check. Try again.');
		expect(checkErrorMessage(apiError(500, 'internal_error'), NOW)).toBe(
			'Could not start the DNS check. Try again.'
		);
	});
});

describe('createErrorMessage', () => {
	it('maps domain creation refusals to plain copy', () => {
		expect(createErrorMessage(apiError(400, 'invalid_request'), NOW)).toBe(
			'This domain cannot be added. Enter a domain you registered yourself, like example.com.'
		);
		expect(createErrorMessage(apiError(409, 'conflict'), NOW)).toBe('This domain is already in your workspace.');
		expect(createErrorMessage(apiError(422, 'unsupported_parameters'), NOW)).toBe(
			"Your plan's domain limit is reached. Remove a domain or change plans to add another."
		);
		expect(createErrorMessage(apiError(429, 'rate_limited', 600), NOW)).toBe(
			'Too many domains were added recently. Try again in 10 minutes.'
		);
		expect(createErrorMessage(apiError(500, 'internal_error'), NOW)).toBe('Could not add domain');
	});

	it('never shows the raw server message', () => {
		expect(createErrorMessage(apiError(400, 'invalid_request'), NOW)).not.toContain('raw server text');
		expect(createErrorMessage(new Error('raw server text'), NOW)).toBe('Could not add domain');
	});

	it('names the plan when domains are not included', () => {
		expect(createErrorMessage(apiError(403, 'upgrade_required'), NOW)).toBe('Your own domain needs a paid plan');
		expect(createErrorMessage(apiError(402, 'payment_required'), NOW)).toBe('Your own domain needs a paid plan');
	});

	it('explains a read-only account', () => {
		expect(createErrorMessage(apiError(403, 'read_only'), NOW)).toBe(
			'Sending and editing are paused. Restore your plan to continue.'
		);
	});
});
