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
	opts: { onHint: (h: unknown) => void; onState?: (s: string, downMs: number) => void };
}> = [];
vi.mock('./connection', () => ({
	RealtimeConnection: class {
		accountId: string;
		start = vi.fn();
		stop = vi.fn();
		kick = vi.fn();
		opts: { onHint: (h: unknown) => void; onState?: (s: string, downMs: number) => void };
		constructor(opts: {
			accountId: string;
			onHint: (h: unknown) => void;
			onState?: (s: string, downMs: number) => void;
		}) {
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
		const cleanup = leaderState.isLeader ? onLead() : null;
		return {
			stop: () => {
				leaderStop();
				cleanup?.();
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
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		status: vi.fn(async () => ({ accounts: keystoreState.accounts })),
		subscribe: (cb: (b: unknown) => void) => keystoreSubscribe(cb)
	}
}));

const authState = vi.hoisted(() => ({ accountId: null as string | null }));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: {
		get accountId() {
			return authState.accountId;
		}
	}
}));

const refreshLoaded = vi.fn();
const refreshCounts = vi.fn();
vi.mock('$core/stores/mailbox.svelte', () => ({
	mailbox: {
		refreshLoaded: (...a: unknown[]) => refreshLoaded(...a),
		refreshCounts: (...a: unknown[]) => refreshCounts(...a)
	}
}));

const unreadRefresh = vi.fn();
vi.mock('$core/stores/unread.svelte', () => ({
	unread: {
		refresh: (...a: unknown[]) => unreadRefresh(...a)
	}
}));

const draftsRefresh = vi.fn();
vi.mock('$core/stores/drafts.svelte', () => ({
	drafts: {
		refresh: (...a: unknown[]) => draftsRefresh(...a)
	}
}));

const scheduledRefresh = vi.fn();
vi.mock('$core/stores/scheduled.svelte', () => ({
	scheduled: {
		refresh: (...a: unknown[]) => scheduledRefresh(...a)
	}
}));

const collectionsSync = vi.fn(async () => false);
vi.mock('$core/stores/mailCollections.svelte', () => ({
	mailCollections: {
		sync: () => collectionsSync()
	}
}));

const searchRefresh = vi.fn();
vi.mock('$core/stores/search.svelte', () => ({
	mailSearch: {
		refresh: (...a: unknown[]) => searchRefresh(...a)
	}
}));

vi.mock('$core/products', () => ({ currentProduct: 'calendar', isProductVault: true }));

const calendarResync = vi.fn();
vi.mock('./calendarHook', () => ({
	notifyCalendarResync: (...a: unknown[]) => calendarResync(...a)
}));

import { realtime } from './realtime.svelte';

describe('realtime store in the calendar product', () => {
	afterEach(() => {
		realtime.stop();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		connInstances.length = 0;
		keystoreState.accounts = [];
		leaderState.isLeader = true;
		authState.accountId = null;
	});

	it('opens a connection per unlocked account without asking mail for unread counts', async () => {
		authState.accountId = 'acc-1';
		keystoreState.accounts = [
			{ accountId: 'acc-1', unlocked: true },
			{ accountId: 'acc-2', unlocked: true }
		];
		realtime.start();
		await vi.waitFor(() => expect(connInstances).toHaveLength(2));
		expect(unreadRefresh).not.toHaveBeenCalled();
	});

	it('a reconnect of the active account resyncs the calendar and nothing in mail', async () => {
		authState.accountId = 'acc-1';
		keystoreState.accounts = [{ accountId: 'acc-1', unlocked: true }];
		realtime.start();
		await vi.waitFor(() => expect(connInstances).toHaveLength(1));

		connInstances[0].opts.onState?.('open', 90_000);

		expect(calendarResync).toHaveBeenCalledWith(true);
		expect(refreshLoaded).not.toHaveBeenCalled();
		expect(refreshCounts).not.toHaveBeenCalled();
		expect(draftsRefresh).not.toHaveBeenCalled();
		expect(scheduledRefresh).not.toHaveBeenCalled();
		expect(searchRefresh).not.toHaveBeenCalled();
		expect(collectionsSync).not.toHaveBeenCalled();
	});

	it('a reconnect of a background account does nothing', async () => {
		authState.accountId = 'acc-1';
		keystoreState.accounts = [
			{ accountId: 'acc-1', unlocked: true },
			{ accountId: 'acc-2', unlocked: true }
		];
		realtime.start();
		await vi.waitFor(() => expect(connInstances).toHaveLength(2));

		connInstances.find((c) => c.accountId === 'acc-2')!.opts.onState?.('open', 90_000);

		expect(calendarResync).not.toHaveBeenCalled();
		expect(unreadRefresh).not.toHaveBeenCalled();
	});
});
