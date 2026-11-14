import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Broadcast } from '$core/keystore/protocol';

const platformState = vi.hoisted(() => ({ mirror: undefined as unknown, keystoreChannel: undefined as unknown }));
vi.mock('$platform', () => ({ platform: platformState }));

const listeners = new Set<(b: Broadcast) => void>();
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribeAccount: (_accountId: string, cb: (b: Broadcast) => void) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		}
	}
}));

const record = vi.fn();
vi.mock('./runtime/records', () => ({ searchRecords: { get: (id: string) => record(id) } }));

const shutdown = vi.fn(async () => {});
const retry = vi.fn();
const startSearch = vi.fn((accountId: string) => ({ accountId, shutdown, retry }));
const wipeSearch = vi.fn(async () => {});
const startLoaded = vi.fn();
vi.mock('./runtime/start', () => {
	startLoaded();
	return { startSearch: (id: string) => startSearch(id), wipeSearch: (id: string) => wipeSearch(id) };
});

async function fresh() {
	vi.resetModules();
	return (await import('./lazy')).searchRuntime;
}

function broadcast(type: string) {
	for (const cb of [...listeners]) cb({ type, accountId: 'acc-1' } as unknown as Broadcast);
}

async function settle() {
	await vi.dynamicImportSettled();
	await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubEnv('PUBLIC_PRIVATE_SEARCH', '1');
	platformState.mirror = undefined;
	platformState.keystoreChannel = undefined;
	listeners.clear();
	record.mockReset();
	record.mockResolvedValue(null);
	shutdown.mockClear();
	retry.mockClear();
	startSearch.mockClear();
	wipeSearch.mockClear();
	startLoaded.mockClear();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe('searchRuntime', () => {
	it('loads nothing while the app boots', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		await vi.advanceTimersByTimeAsync(100);
		expect(startLoaded).not.toHaveBeenCalled();
		expect(record).not.toHaveBeenCalled();
		detach();
	});

	it('stays off at idle when no index exists', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		await vi.advanceTimersByTimeAsync(3000);
		await settle();
		expect(record).toHaveBeenCalledWith('acc-1');
		expect(startLoaded).not.toHaveBeenCalled();
		detach();
	});

	it('starts at idle when an index exists', async () => {
		record.mockResolvedValue({ hasIndex: true });
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		await vi.advanceTimersByTimeAsync(3000);
		await settle();
		expect(startSearch).toHaveBeenCalledWith('acc-1');
		detach();
	});

	it('starts once on the first focus of the search field', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		runtime.focus();
		await settle();
		expect(startSearch).toHaveBeenCalledTimes(1);
		detach();
	});

	it('does nothing when the feature is off', async () => {
		vi.stubEnv('PUBLIC_PRIVATE_SEARCH', '');
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await vi.advanceTimersByTimeAsync(5000);
		await settle();
		expect(startLoaded).not.toHaveBeenCalled();
		expect(listeners.size).toBe(0);
		detach();
	});

	it('does nothing on the desktop build', async () => {
		platformState.mirror = {};
		platformState.keystoreChannel = {};
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await vi.advanceTimersByTimeAsync(5000);
		await settle();
		expect(startLoaded).not.toHaveBeenCalled();
		detach();
	});

	it('shuts the client down when the account closes', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		detach();
		await settle();
		expect(shutdown).toHaveBeenCalledWith({ wipe: false });
		expect(runtime.client()).toBeNull();
	});

	it('shuts down on lock and keeps the index', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		broadcast('locked');
		await settle();
		expect(shutdown).toHaveBeenCalledWith({ wipe: false });
		detach();
	});

	it('wipes the index when the account is removed', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		broadcast('cleared');
		await settle();
		expect(shutdown).toHaveBeenCalledWith({ wipe: true });
		detach();
	});

	it('wipes a stored index on removal even if search never started', async () => {
		record.mockResolvedValue({ hasIndex: true });
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		broadcast('clearedAll');
		await settle();
		expect(startSearch).not.toHaveBeenCalled();
		expect(wipeSearch).toHaveBeenCalledWith('acc-1');
		detach();
	});

	it('retries a waiting client when the vault changes', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		broadcast('vaultChanged');
		await settle();
		expect(retry).toHaveBeenCalledTimes(1);
		detach();
	});
});
