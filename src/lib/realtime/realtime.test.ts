import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const applyHint = vi.fn();
vi.mock('./dispatch', () => ({
	applyHint: (...a: unknown[]) => applyHint(...a)
}));

const connCtor = vi.fn();
const connInstances: Array<{
	accountId: string;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	kick: ReturnType<typeof vi.fn>;
	opts: { onHint: (h: unknown) => void; onState?: (s: string) => void };
}> = [];
vi.mock('./connection', () => ({
	RealtimeConnection: class {
		accountId: string;
		start = vi.fn();
		stop = vi.fn();
		kick = vi.fn();
		opts: { onHint: (h: unknown) => void; onState?: (s: string) => void };
		constructor(opts: { accountId: string; onHint: (h: unknown) => void; onState?: (s: string) => void }) {
			this.accountId = opts.accountId;
			this.opts = opts;
			connCtor(opts.accountId);
			connInstances.push(this as unknown as (typeof connInstances)[number]);
		}
	}
}));

const leaderState = vi.hoisted(() => ({ isLeader: true }));
const electLeaderSpy = vi.fn();
const leaderStop = vi.fn();
vi.mock('./leader', () => ({
	electLeader: (name: string, onLead: () => () => void) => {
		electLeaderSpy(name);
		const cleanup = onLead();
		return {
			stop: () => {
				leaderStop();
				cleanup();
			},
			get isLeader() {
				return leaderState.isLeader;
			}
		};
	}
}));

const channelClose = vi.fn();
const channelPost = vi.fn();
vi.mock('./channel', () => ({
	openRealtimeChannel: vi.fn(() => ({ post: channelPost, close: channelClose }))
}));

const keystoreState = vi.hoisted(() => ({
	accounts: [] as { accountId: string; unlocked: boolean }[]
}));
const keystoreSubscribe = vi.fn((_cb: (b: unknown) => void) => () => {});
vi.mock('$lib/keystore/keystore-client', () => ({
	keystore: {
		status: vi.fn(async () => ({ accounts: keystoreState.accounts })),
		subscribe: (cb: (b: unknown) => void) => keystoreSubscribe(cb)
	}
}));

import { realtime } from './realtime.svelte';

describe('realtime store', () => {
	afterEach(() => {
		realtime.stop();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		connInstances.length = 0;
		keystoreState.accounts = [];
		leaderState.isLeader = true;
	});

	it('opens one connection per unlocked account on sync', async () => {
		keystoreState.accounts = [
			{ accountId: 'acc-1', unlocked: true },
			{ accountId: 'acc-2', unlocked: false },
			{ accountId: 'acc-3', unlocked: true }
		];
		realtime.start();
		await vi.waitFor(() => expect(connCtor).toHaveBeenCalled());

		expect(connCtor).toHaveBeenCalledWith('acc-1');
		expect(connCtor).toHaveBeenCalledWith('acc-3');
		expect(connCtor).not.toHaveBeenCalledWith('acc-2');
		expect(connInstances.every((c) => c.start.mock.calls.length === 1)).toBe(true);
	});

	it('stops a connection whose account becomes locked on the next sync', async () => {
		keystoreState.accounts = [{ accountId: 'acc-1', unlocked: true }];
		realtime.start();
		await vi.waitFor(() => expect(connInstances).toHaveLength(1));

		keystoreState.accounts = [{ accountId: 'acc-1', unlocked: false }];
		await realtime.sync();

		expect(connInstances[0].stop).toHaveBeenCalledTimes(1);
	});

	it('does not open a duplicate connection for an already-connected account', async () => {
		keystoreState.accounts = [{ accountId: 'acc-1', unlocked: true }];
		realtime.start();
		await vi.waitFor(() => expect(connInstances).toHaveLength(1));

		await realtime.sync();
		expect(connCtor).toHaveBeenCalledTimes(1);
	});

	it('does nothing on sync when not the leader', async () => {
		leaderState.isLeader = false;
		keystoreState.accounts = [{ accountId: 'acc-1', unlocked: true }];
		realtime.start();
		await realtime.sync();
		expect(connCtor).not.toHaveBeenCalled();
	});

	it('wake() kicks every open connection', async () => {
		keystoreState.accounts = [
			{ accountId: 'acc-1', unlocked: true },
			{ accountId: 'acc-2', unlocked: true }
		];
		realtime.start();
		await vi.waitFor(() => expect(connInstances).toHaveLength(2));

		realtime.wake();
		expect(connInstances[0].kick).toHaveBeenCalledTimes(1);
		expect(connInstances[1].kick).toHaveBeenCalledTimes(1);
	});

	it('stateFor reflects the connection onState callback', async () => {
		keystoreState.accounts = [{ accountId: 'acc-1', unlocked: true }];
		realtime.start();
		await vi.waitFor(() => expect(connInstances).toHaveLength(1));

		expect(realtime.stateFor('acc-1')).toBe('idle');
		connInstances[0].opts.onState?.('open');
		expect(realtime.stateFor('acc-1')).toBe('open');
	});

	it('applies a hint from its own connection and posts it to the broadcast channel', async () => {
		keystoreState.accounts = [{ accountId: 'acc-1', unlocked: true }];
		realtime.start();
		await vi.waitFor(() => expect(connInstances).toHaveLength(1));

		const hint = { accountId: 'acc-1', kind: 'message.created' as const, id: 'm1' };
		connInstances[0].opts.onHint(hint);

		expect(applyHint).toHaveBeenCalledWith(hint);
		expect(channelPost).toHaveBeenCalledWith({ type: 'hint', hint });
	});

	it('applies a hint received from the broadcast channel', async () => {
		const { openRealtimeChannel } = await import('./channel');
		keystoreState.accounts = [];
		realtime.start();
		await vi.waitFor(() => expect(openRealtimeChannel).toHaveBeenCalled());

		const onMessage = vi.mocked(openRealtimeChannel).mock.calls[0][0];
		const hint = { accountId: 'acc-9', kind: 'message.created' as const, id: 'm9' };
		onMessage({ type: 'hint', hint });

		expect(applyHint).toHaveBeenCalledWith(hint);
	});

	it('stop() tears down connections and the channel', async () => {
		keystoreState.accounts = [{ accountId: 'acc-1', unlocked: true }];
		realtime.start();
		await vi.waitFor(() => expect(connInstances).toHaveLength(1));

		realtime.stop();
		expect(leaderStop).toHaveBeenCalledTimes(1);
		expect(connInstances[0].stop).toHaveBeenCalledTimes(1);
		expect(channelClose).toHaveBeenCalledTimes(1);
	});
});
