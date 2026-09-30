import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const api = vi.hoisted(() => ({
	get: vi.fn(),
	start: vi.fn(),
	stop: vi.fn()
}));

vi.mock('$core/api/messages', () => ({
	getReplyPresence: (...a: unknown[]) => api.get(...a),
	startReplyPresence: (...a: unknown[]) => api.start(...a),
	stopReplyPresence: (...a: unknown[]) => api.stop(...a)
}));

import { replyPresence, announceReplying } from './replyPresence.svelte';
import { ApiCallError } from '$core/api/types';

const NOW = Date.parse('2026-09-30T12:00:00Z');

function entry(accountId: string, expiresInMs: number) {
	return {
		aliasId: 'alias-1',
		accountId,
		since: new Date(NOW).toISOString(),
		expiresAt: new Date(NOW + expiresInMs).toISOString()
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	api.get.mockReset();
	api.start.mockReset().mockResolvedValue({ ttlSeconds: 45 });
	api.stop.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('replyPresence.watch', () => {
	it('loads who is replying and clears it when the watch ends', async () => {
		api.get.mockResolvedValue({ replying: [entry('ben', 30_000)] });
		const unwatch = replyPresence.watch('m1', 't1');
		await vi.advanceTimersByTimeAsync(0);
		expect(api.get).toHaveBeenCalledWith('m1');
		expect(replyPresence.replying.map((e) => e.accountId)).toEqual(['ben']);
		unwatch();
		expect(replyPresence.replying).toEqual([]);
	});

	it('checks again when the earliest mark lapses', async () => {
		api.get.mockResolvedValueOnce({ replying: [entry('ben', 5_000)] }).mockResolvedValueOnce({ replying: [] });
		const unwatch = replyPresence.watch('m1', 't1');
		await vi.advanceTimersByTimeAsync(0);
		expect(replyPresence.replying).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(5_300);
		expect(api.get).toHaveBeenCalledTimes(2);
		expect(replyPresence.replying).toEqual([]);
		unwatch();
	});

	it('refetches on a hint for the watched thread and ignores other threads', async () => {
		api.get.mockResolvedValue({ replying: [] });
		const unwatch = replyPresence.watch('m1', 't1');
		await vi.advanceTimersByTimeAsync(0);
		replyPresence.onHint({ accountId: 'a', kind: 'reply_presence.updated', id: 'x', thread_id: 't2' });
		await vi.advanceTimersByTimeAsync(0);
		expect(api.get).toHaveBeenCalledTimes(1);
		replyPresence.onHint({ accountId: 'a', kind: 'reply_presence.updated', id: 'x', thread_id: 't1' });
		await vi.advanceTimersByTimeAsync(0);
		expect(api.get).toHaveBeenCalledTimes(2);
		unwatch();
	});

	it('drops a late answer for a message that is no longer open', async () => {
		let resolveFirst: (v: unknown) => void = () => {};
		api.get
			.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
			.mockResolvedValueOnce({ replying: [] });
		replyPresence.watch('m1', 't1');
		const unwatch = replyPresence.watch('m2', 't2');
		await vi.advanceTimersByTimeAsync(0);
		resolveFirst({ replying: [entry('ben', 30_000)] });
		await vi.advanceTimersByTimeAsync(0);
		expect(replyPresence.replying).toEqual([]);
		unwatch();
	});
});

describe('announceReplying', () => {
	it('marks right away, keeps the mark alive and clears it at the end', async () => {
		const stop = announceReplying('m1');
		await vi.advanceTimersByTimeAsync(0);
		expect(api.start).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(api.start).toHaveBeenCalledTimes(2);
		stop();
		expect(api.stop).toHaveBeenCalledWith('m1');
		await vi.advanceTimersByTimeAsync(40_000);
		expect(api.start).toHaveBeenCalledTimes(2);
	});

	it('stops quietly when the message is not shared-address mail', async () => {
		api.start.mockRejectedValue(new ApiCallError(400, null, 'not shared'));
		const stop = announceReplying('m1');
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(api.start).toHaveBeenCalledTimes(1);
		stop();
		expect(api.stop).not.toHaveBeenCalled();
	});

	it('clears the mark with a keepalive request when the page goes away', async () => {
		const stop = announceReplying('m1');
		await vi.advanceTimersByTimeAsync(0);
		window.dispatchEvent(new Event('pagehide'));
		expect(api.stop).toHaveBeenCalledWith('m1', { keepalive: true });
		stop();
	});
});
