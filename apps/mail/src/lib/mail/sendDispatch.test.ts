import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = vi.hoisted(() => ({
	internal: [] as { input: Record<string, unknown>; opts: Record<string, unknown> }[],
	external: [] as Record<string, unknown>[]
}));

vi.mock('./send', () => {
	class SendError extends Error {
		code: string;
		constructor(code: string, message?: string) {
			super(message ?? code);
			this.code = code;
			this.name = 'SendError';
		}
	}
	return {
		SendError,
		sendErrorFromApi: (e: unknown, fallback: string) =>
			new SendError('unknown', e instanceof Error ? e.message : fallback),
		sendInternalMessage: async (
			input: Record<string, unknown>,
			opts: Record<string, unknown> = {}
		) => {
			calls.internal.push({ input, opts });
			if (input.scheduledAt) {
				return { messageId: undefined as unknown as string, storedAt: '' };
			}
			return { messageId: 'internal-1', storedAt: '2026-01-01T00:00:00Z' };
		}
	};
});

vi.mock('./sendExternal', () => ({
	sendExternalMessage: async (input: Record<string, unknown>) => {
		calls.external.push(input);
		return { messageId: 'external-1', enqueuedAt: '2026-01-01T00:00:00Z' };
	}
}));

vi.mock('$lib/api/accounts', async () => {
	const { ApiCallError } = await import('$lib/api/types');
	return {
		lookupAccount: async (email: string) => {
			if (email.endsWith('@thelemail.test')) return { accountId: `acct:${email}` };
			throw new ApiCallError(404, null, 'no such account');
		}
	};
});

import { dispatchSend, MIXED_SCHEDULE_MESSAGE } from './sendDispatch';
import { SendError } from './send';

function party(address: string) {
	return { display: address, address };
}

const WHEN = '2026-01-02T09:00:00.000Z';

beforeEach(() => {
	calls.internal.length = 0;
	calls.external.length = 0;
});

describe('dispatchSend scheduling', () => {
	it('refuses to schedule a mixed internal and external send instead of creating two holds', async () => {
		const err = await dispatchSend({
			to: [party('friend@thelemail.test')],
			cc: [party('outsider@example.test')],
			subject: 'later',
			body: 'hello',
			scheduledAt: WHEN
		}).catch((e) => e);

		expect(err).toBeInstanceOf(SendError);
		expect((err as SendError).code).toBe('schedule_unsupported');
		expect((err as SendError).message).toBe(MIXED_SCHEDULE_MESSAGE);
		expect(calls.internal).toHaveLength(0);
		expect(calls.external).toHaveLength(0);
	});

	it('holds an all-internal send as a single scheduled send', async () => {
		await dispatchSend({
			to: [party('a@thelemail.test'), party('b@thelemail.test')],
			subject: 'later',
			body: 'hello',
			scheduledAt: WHEN
		});

		expect(calls.internal).toHaveLength(1);
		expect(calls.internal[0].input.scheduledAt).toBe(WHEN);
		expect(calls.external).toHaveLength(0);
	});

	it('holds an all-external send as a single scheduled send', async () => {
		await dispatchSend({
			to: [party('one@example.test'), party('two@example.test')],
			subject: 'later',
			body: 'hello',
			scheduledAt: WHEN
		});

		expect(calls.external).toHaveLength(1);
		expect(calls.external[0].scheduledAt).toBe(WHEN);
		expect(calls.internal).toHaveLength(0);
	});

	it('still splits an unscheduled mixed send and links the external leg to the sent copy', async () => {
		await dispatchSend({
			to: [party('friend@thelemail.test'), party('outsider@example.test')],
			subject: 'now',
			body: 'hello'
		});

		expect(calls.internal).toHaveLength(1);
		expect(calls.internal[0].opts.deliverOnly).toEqual(new Set(['friend@thelemail.test']));
		expect(calls.external).toHaveLength(1);
		expect(calls.external[0].sentMessageId).toBe('internal-1');
		expect(calls.external[0].scheduledAt).toBeUndefined();
	});
});
