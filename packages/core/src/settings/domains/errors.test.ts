import { describe, expect, it } from 'vitest';
import { ApiCallError, type ErrorCode } from '$core/api/types';
import { checkErrorMessage } from './errors';

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
