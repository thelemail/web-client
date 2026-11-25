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

type Prefs = { accountId: string; consent: 'saved' | 'declined' | null; paused: boolean; history: boolean; semantic: boolean };
const stored = vi.hoisted(() => ({ prefs: new Map<string, Prefs>(), record: null as unknown }));
const deletePrefs = vi.fn();
const dropAssets = vi.fn(async () => {});
vi.mock('./model/assets', () => ({ dropAssets: () => dropAssets() }));
vi.mock('./runtime/records', () => {
	const base = (accountId: string): Prefs => ({ accountId, consent: null, paused: false, history: false, semantic: false });
	return {
		defaultPrefs: base,
		semanticInUse: async () => [...stored.prefs.values()].some((p) => p.semantic),
		searchRecords: { get: async () => stored.record },
		searchPrefs: {
			get: async (id: string) => ({ ...base(id), ...stored.prefs.get(id) }),
			put: async (p: Prefs) => void stored.prefs.set(p.accountId, { ...p }),
			delete: async (id: string) => {
				deletePrefs(id);
				stored.prefs.delete(id);
			}
		}
	};
});

const shutdown = vi.fn(async () => {});
const retry = vi.fn();
const pause = vi.fn(async () => {});
const forget = vi.fn(async () => {});
const startSearch = vi.fn((accountId: string, consent: string) => ({
	accountId,
	mode: consent === 'saved' ? 'saved' : 'preview',
	shutdown,
	retry,
	pause,
	forget
}));
const wipeSearch = vi.fn(async () => {});
const startLoaded = vi.fn();
vi.mock('./runtime/start', () => {
	startLoaded();
	return { startSearch: (id: string, consent: string) => startSearch(id, consent), wipeSearch: (id: string) => wipeSearch(id) };
});

const deleted = vi.fn();

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
	await vi.dynamicImportSettled();
	await vi.advanceTimersByTimeAsync(0);
}

function consent(value: Prefs['consent']) {
	stored.prefs.set('acc-1', { accountId: 'acc-1', consent: value, paused: false, history: false, semantic: false });
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal('indexedDB', { deleteDatabase: deleted });
	platformState.mirror = undefined;
	platformState.keystoreChannel = undefined;
	listeners.clear();
	stored.prefs.clear();
	stored.record = null;
	for (const f of [shutdown, retry, pause, forget, startSearch, wipeSearch, startLoaded, deleted, deletePrefs]) f.mockClear();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('searchRuntime', () => {
	it('loads nothing while the app boots', async () => {
		consent('saved');
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		await vi.advanceTimersByTimeAsync(100);
		expect(startLoaded).not.toHaveBeenCalled();
		expect(deleted).not.toHaveBeenCalled();
		detach();
	});

	it('removes the old preview index database after boot', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		await vi.advanceTimersByTimeAsync(3000);
		await settle();
		expect(deleted).toHaveBeenCalledWith('thelemail-search');
		detach();
	});

	it('stays off at idle without consent, even with an old index on disk', async () => {
		stored.record = { hasIndex: true };
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		await vi.advanceTimersByTimeAsync(3000);
		await settle();
		expect(startLoaded).not.toHaveBeenCalled();
		detach();
	});

	it('starts the saved index at idle once the user turned it on', async () => {
		consent('saved');
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		await vi.advanceTimersByTimeAsync(3000);
		await settle();
		expect(startSearch).toHaveBeenCalledWith('acc-1', 'saved');
		detach();
	});

	it('searches previews in memory on first focus when the user has not chosen', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		runtime.focus();
		await settle();
		expect(startSearch).toHaveBeenCalledTimes(1);
		expect(startSearch).toHaveBeenCalledWith('acc-1', 'declined');
		expect(runtime.prefs?.consent).toBeNull();
		detach();
	});

	it('switches from previews to the saved index when the user turns it on', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		await runtime.enable();
		await settle();
		expect(shutdown).toHaveBeenCalledWith({ wipe: false });
		expect(startSearch).toHaveBeenLastCalledWith('acc-1', 'saved');
		expect(stored.prefs.get('acc-1')?.consent).toBe('saved');
		detach();
	});

	it('records a decline without starting anything heavy', async () => {
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		await runtime.decline();
		await settle();
		expect(startSearch).toHaveBeenCalledTimes(1);
		expect(stored.prefs.get('acc-1')?.consent).toBe('declined');
		detach();
	});

	it('clears this device and falls back to previews', async () => {
		consent('saved');
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		await runtime.clear();
		await settle();
		expect(shutdown).toHaveBeenCalledWith({ wipe: true });
		expect(startSearch).toHaveBeenLastCalledWith('acc-1', 'declined');
		expect(stored.prefs.get('acc-1')).toMatchObject({ consent: 'declined', history: false });
		detach();
	});

	it('rebuilds by wiping and starting a fresh saved index', async () => {
		consent('saved');
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		await runtime.rebuild();
		await settle();
		expect(shutdown).toHaveBeenCalledWith({ wipe: true });
		expect(startSearch).toHaveBeenCalledTimes(2);
		expect(startSearch).toHaveBeenLastCalledWith('acc-1', 'saved');
		detach();
	});

	it('turns search by meaning on with a restart and keeps the model while in use', async () => {
		consent('saved');
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		dropAssets.mockClear();
		await runtime.setSemantic(true);
		await settle();
		expect(stored.prefs.get('acc-1')?.semantic).toBe(true);
		expect(shutdown).toHaveBeenCalledWith({ wipe: false });
		expect(startSearch).toHaveBeenCalledTimes(2);
		expect(dropAssets).not.toHaveBeenCalled();
		detach();
	});

	it('drops the downloaded model when no account uses search by meaning any more', async () => {
		consent('saved');
		stored.prefs.set('acc-1', { ...stored.prefs.get('acc-1')!, semantic: true });
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		dropAssets.mockClear();
		await runtime.setSemantic(false);
		await settle();
		expect(stored.prefs.get('acc-1')?.semantic).toBe(false);
		expect(dropAssets).toHaveBeenCalledTimes(1);
		detach();
	});

	it('turns search by meaning off with full search', async () => {
		consent('saved');
		stored.prefs.set('acc-1', { ...stored.prefs.get('acc-1')!, semantic: true });
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		await runtime.clear();
		await settle();
		expect(stored.prefs.get('acc-1')?.semantic).toBe(false);
		detach();
	});

	it('remembers pause and tells the running index', async () => {
		consent('saved');
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		await runtime.setPaused(true);
		expect(pause).toHaveBeenCalledWith(true);
		expect(stored.prefs.get('acc-1')?.paused).toBe(true);
		detach();
	});

	it('forgets history when history is turned off', async () => {
		consent('saved');
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		await runtime.setHistory(true);
		expect(forget).not.toHaveBeenCalled();
		await runtime.setHistory(false);
		expect(forget).toHaveBeenCalledTimes(1);
		detach();
	});

	it('keeps previews only while the vault cannot hold a search root', async () => {
		consent('saved');
		const runtime = await fresh();
		const detach = runtime.attach('acc-1', () => false);
		await vi.advanceTimersByTimeAsync(3000);
		await settle();
		expect(startSearch).not.toHaveBeenCalled();
		runtime.focus();
		await settle();
		expect(startSearch).toHaveBeenCalledWith('acc-1', 'declined');
		await runtime.enable();
		expect(startSearch).toHaveBeenCalledTimes(1);
		expect(runtime.fullSearch).toBe(false);
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
		expect(listeners.size).toBe(0);
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

	it('wipes the index and the choices when the account is removed', async () => {
		consent('saved');
		const runtime = await fresh();
		const detach = runtime.attach('acc-1');
		runtime.focus();
		await settle();
		broadcast('cleared');
		await settle();
		expect(shutdown).toHaveBeenCalledWith({ wipe: true });
		expect(deletePrefs).toHaveBeenCalledWith('acc-1');
		detach();
	});

	it('wipes a stored index on removal even if search never started', async () => {
		stored.record = { hasIndex: true };
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
