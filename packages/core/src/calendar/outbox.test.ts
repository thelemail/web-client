import { describe, expect, it, vi } from 'vitest';
import { ApiCallError } from '$core/api/types';
import type { OutboxRecord } from './db';
import { classifyError, replayOne, type ReplayApi, type ReplayHooks } from './outbox';

function apiError(status: number, code: string, retryAfterSeconds?: number): ApiCallError {
	return new ApiCallError(
		status,
		{ error: { code: code as never, message: code, retryAfterSeconds } },
		code
	);
}

function record(fields?: string[]): OutboxRecord {
	return {
		seq: 1,
		accountId: 'a',
		status: 'queued',
		attempts: 0,
		createdAt: 0,
		op: {
			kind: 'item.put',
			calendarId: 'c',
			itemId: 'i',
			label: 'Edit',
			fields,
			body: {
				baseRev: 1,
				privacy: 'busy',
				sealed: 'x',
				keyFingerprint: 'f',
				schemaVersion: 1,
				busyWindows: []
			}
		}
	};
}

function api(putItem: ReplayApi['putItem']): ReplayApi {
	return {
		putItem,
		deleteItem: vi.fn(async () => {}),
		putState: vi.fn(async () => ({})),
		patchCalendar: vi.fn(async () => ({})),
		deleteCalendar: vi.fn(async () => {}),
		sendMail: vi.fn(async () => {})
	};
}

type Hooks = ReplayHooks & { applied: ReturnType<typeof vi.fn>; dropped: ReturnType<typeof vi.fn> };

function hooks(rebase: ReplayHooks['rebase'] = async () => null): Hooks {
	return { applied: vi.fn(async () => {}), rebase, dropped: vi.fn(async () => {}) };
}

describe('classifyError', () => {
	it('maps api statuses', () => {
		expect(classifyError(apiError(409, 'stale_revision')).cls).toBe('conflict');
		expect(classifyError(apiError(404, 'not_found')).cls).toBe('not_found');
		expect(classifyError(apiError(402, 'upgrade_required')).cls).toBe('upgrade_required');
		expect(classifyError(apiError(403, 'read_only')).cls).toBe('paused');
		expect(classifyError(apiError(429, 'rate_limited', 7))).toEqual({
			cls: 'rate_limited',
			retryAfterMs: 7000,
			message: 'rate_limited'
		});
		expect(classifyError(apiError(503, 'service_unavailable')).cls).toBe('server');
		expect(classifyError(new TypeError('Failed to fetch')).cls).toBe('offline');
	});
});

describe('replayOne', () => {
	it('applies and reports the result', async () => {
		const h = hooks();
		const out = await replayOne(
			record(),
			api(async () => ({ id: 'i', rev: 2, updatedAt: 'now' })),
			h
		);
		expect(out).toEqual({ outcome: 'applied' });
		expect(h.applied).toHaveBeenCalledWith(expect.anything(), {
			id: 'i',
			rev: 2,
			updatedAt: 'now'
		});
	});

	it('rebases a partstat-only change on conflict and retries once', async () => {
		let calls = 0;
		const put = vi.fn(async () => {
			calls += 1;
			if (calls === 1) throw apiError(409, 'stale_revision');
			return { id: 'i', rev: 3, updatedAt: 'now' };
		});
		const rebased = record(['partstat']);
		if (rebased.op.kind === 'item.put') rebased.op.body = { ...rebased.op.body, baseRev: 2 };
		const h = hooks(async () => rebased);
		const out = await replayOne(record(['partstat']), api(put), h);
		expect(out).toEqual({ outcome: 'applied' });
		expect(put).toHaveBeenCalledTimes(2);
	});

	it('blocks other conflicts for the user', async () => {
		const out = await replayOne(
			record(['title']),
			api(async () => {
				throw apiError(409, 'stale_revision');
			}),
			hooks()
		);
		expect(out.outcome).toBe('blocked');
	});

	it('drops on 404 and halts on upgrade required', async () => {
		const h = hooks();
		const dropped = await replayOne(
			record(),
			api(async () => {
				throw apiError(404, 'not_found');
			}),
			h
		);
		expect(dropped.outcome).toBe('dropped');
		expect(h.dropped).toHaveBeenCalledWith(expect.anything(), 'not_found', 'not_found');
		const halt = await replayOne(
			record(),
			api(async () => {
				throw apiError(402, 'upgrade_required');
			}),
			hooks()
		);
		expect(halt).toEqual({ outcome: 'halt', cls: 'upgrade_required', message: 'upgrade_required' });
	});

	it('retries with backoff when offline or rate limited', async () => {
		const offline = await replayOne(
			{ ...record(), attempts: 2 },
			api(async () => {
				throw new TypeError('Failed to fetch');
			}),
			hooks()
		);
		expect(offline).toEqual({ outcome: 'retry', delayMs: 4000, offline: true });
		const limited = await replayOne(
			record(),
			api(async () => {
				throw apiError(429, 'rate_limited', 12);
			}),
			hooks()
		);
		expect(limited).toEqual({ outcome: 'retry', delayMs: 12000, offline: false });
	});
});
