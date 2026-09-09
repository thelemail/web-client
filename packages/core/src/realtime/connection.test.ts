import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeConnection, type EventSourceLike } from './connection';

class FakeEventSource implements EventSourceLike {
	onopen: ((ev: Event) => void) | null = null;
	onerror: ((ev: Event) => void) | null = null;
	onmessage: ((ev: MessageEvent) => void) | null = null;
	closed = false;
	closeCount = 0;
	constructor(public url: string) {}
	close(): void {
		this.closed = true;
		this.closeCount++;
	}
}

function statusError(status: number): Error {
	return Object.assign(new Error('http error'), { status });
}

describe('RealtimeConnection', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('mints exactly one ticket per connect attempt', async () => {
		const mint = vi.fn().mockResolvedValue({ ticket: 't1', expiresAt: '2026-01-01T00:00:00Z' });
		const sources: FakeEventSource[] = [];
		const open = vi.fn((url: string) => {
			const es = new FakeEventSource(url);
			sources.push(es);
			return es;
		});
		const conn = new RealtimeConnection({ accountId: 'acc-1', onHint: vi.fn(), mint, open });

		conn.start();
		await vi.waitFor(() => expect(mint).toHaveBeenCalledTimes(1));
		expect(open).toHaveBeenCalledTimes(1);
		expect(sources[0].url).toContain('ticket=t1');
	});

	it('mints a fresh ticket on every reconnect', async () => {
		let ticketNum = 0;
		const mint = vi.fn().mockImplementation(async () => ({
			ticket: `t${++ticketNum}`,
			expiresAt: '2026-01-01T00:00:00Z'
		}));
		const sources: FakeEventSource[] = [];
		const open = vi.fn((url: string) => {
			const es = new FakeEventSource(url);
			sources.push(es);
			return es;
		});
		const conn = new RealtimeConnection({ accountId: 'acc-1', onHint: vi.fn(), mint, open });

		conn.start();
		await vi.waitFor(() => expect(sources).toHaveLength(1));
		sources[0].onerror?.(new Event('error'));

		await vi.advanceTimersByTimeAsync(2000);
		await vi.waitFor(() => expect(sources).toHaveLength(2));

		expect(mint).toHaveBeenCalledTimes(2);
		expect(sources[1].url).toContain('ticket=t2');
	});

	it('calls close() synchronously inside onerror to defeat native reconnect', async () => {
		const mint = vi.fn().mockResolvedValue({ ticket: 't1', expiresAt: '2026-01-01T00:00:00Z' });
		const sources: FakeEventSource[] = [];
		const open = vi.fn((url: string) => {
			const es = new FakeEventSource(url);
			sources.push(es);
			return es;
		});
		const conn = new RealtimeConnection({ accountId: 'acc-1', onHint: vi.fn(), mint, open });

		conn.start();
		await vi.waitFor(() => expect(sources).toHaveLength(1));
		expect(sources[0].closed).toBe(false);
		sources[0].onerror?.(new Event('error'));
		expect(sources[0].closed).toBe(true);
		expect(sources[0].closeCount).toBe(1);
	});

	it('schedules a reconnect with backoff after an error', async () => {
		const mint = vi.fn().mockResolvedValue({ ticket: 't1', expiresAt: '2026-01-01T00:00:00Z' });
		const sources: FakeEventSource[] = [];
		const open = vi.fn((url: string) => {
			const es = new FakeEventSource(url);
			sources.push(es);
			return es;
		});
		const conn = new RealtimeConnection({ accountId: 'acc-1', onHint: vi.fn(), mint, open });

		conn.start();
		await vi.waitFor(() => expect(sources).toHaveLength(1));
		sources[0].onerror?.(new Event('error'));
		expect(conn.state).toBe('reconnecting');

		await vi.advanceTimersByTimeAsync(5);
		expect(sources).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(2000);
		await vi.waitFor(() => expect(sources).toHaveLength(2));
	});

	it('does not reconnect after stop()', async () => {
		const mint = vi.fn().mockResolvedValue({ ticket: 't1', expiresAt: '2026-01-01T00:00:00Z' });
		const sources: FakeEventSource[] = [];
		const open = vi.fn((url: string) => {
			const es = new FakeEventSource(url);
			sources.push(es);
			return es;
		});
		const conn = new RealtimeConnection({ accountId: 'acc-1', onHint: vi.fn(), mint, open });

		conn.start();
		await vi.waitFor(() => expect(sources).toHaveLength(1));
		conn.stop();
		expect(sources[0].closed).toBe(true);
		expect(conn.state).toBe('stopped');

		sources[0].onerror?.(new Event('error'));
		await vi.advanceTimersByTimeAsync(60000);
		expect(sources).toHaveLength(1);
		expect(mint).toHaveBeenCalledTimes(1);
	});

	it('carries the last event id as since on reconnect', async () => {
		const mint = vi.fn().mockResolvedValue({ ticket: 't1', expiresAt: '2026-01-01T00:00:00Z' });
		const sources: FakeEventSource[] = [];
		const open = vi.fn((url: string) => {
			const es = new FakeEventSource(url);
			sources.push(es);
			return es;
		});
		const conn = new RealtimeConnection({ accountId: 'acc-1', onHint: vi.fn(), mint, open });

		conn.start();
		await vi.waitFor(() => expect(sources).toHaveLength(1));
		sources[0].onmessage?.(
			new MessageEvent('message', { data: JSON.stringify({ kind: 'message.created', id: 'm1' }), lastEventId: '42' })
		);
		expect(conn.lastEventId).toBe('42');

		sources[0].onerror?.(new Event('error'));
		await vi.advanceTimersByTimeAsync(2000);
		await vi.waitFor(() => expect(sources).toHaveLength(2));
		expect(sources[1].url).toContain('since=42');
	});

	it('permanently disables after a 404 from mint, without scheduling a reconnect', async () => {
		const mint = vi.fn().mockRejectedValue(statusError(404));
		const open = vi.fn();
		const conn = new RealtimeConnection({ accountId: 'acc-1', onHint: vi.fn(), mint, open });

		conn.start();
		await vi.waitFor(() => expect(conn.state).toBe('stopped'));

		await vi.advanceTimersByTimeAsync(60000);
		expect(mint).toHaveBeenCalledTimes(1);
		expect(open).not.toHaveBeenCalled();
	});

	it('dispatches a received hint with the account id attached', async () => {
		const mint = vi.fn().mockResolvedValue({ ticket: 't1', expiresAt: '2026-01-01T00:00:00Z' });
		const sources: FakeEventSource[] = [];
		const open = vi.fn((url: string) => {
			const es = new FakeEventSource(url);
			sources.push(es);
			return es;
		});
		const onHint = vi.fn();
		const conn = new RealtimeConnection({ accountId: 'acc-1', onHint, mint, open });

		conn.start();
		await vi.waitFor(() => expect(sources).toHaveLength(1));
		sources[0].onmessage?.(
			new MessageEvent('message', {
				data: JSON.stringify({ kind: 'message.created', id: 'm1', rev: 7 })
			})
		);

		expect(onHint).toHaveBeenCalledWith({ kind: 'message.created', id: 'm1', rev: 7, accountId: 'acc-1' });
	});
});
