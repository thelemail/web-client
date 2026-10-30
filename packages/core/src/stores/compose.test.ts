import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'thelemail.compose.expanded';

function memoryStorage() {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, String(v)),
		removeItem: (k: string) => void data.delete(k)
	};
}

let storage: ReturnType<typeof memoryStorage>;

async function load() {
	vi.resetModules();
	return (await import('./compose.svelte')).composeStore;
}

beforeEach(() => {
	storage = memoryStorage();
	vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('composeStore', () => {
	it('keeps earlier drafts open and focuses the newest', async () => {
		const store = await load();
		const a = store.openNew();
		const b = store.openNew();
		expect(store.sessions.map((s) => s.key)).toEqual([a, b]);
		expect(store.focused).toBe(b);
		expect(store.open).toBe(true);
	});

	it('focuses an already open draft instead of opening it twice', async () => {
		const store = await load();
		const a = store.openDraft('d1');
		store.openNew();
		expect(store.openDraft('d1')).toBe(a);
		expect(store.sessions).toHaveLength(2);
		expect(store.focused).toBe(a);
	});

	it('recognises a new message by the draft id it was saved under', async () => {
		const store = await load();
		const a = store.openNew();
		store.bindDraft(a, 'd9');
		store.minimize(a);
		expect(store.isOpen('d9')).toBe(true);
		expect(store.openDraft('d9')).toBe(a);
		expect(store.sessions).toHaveLength(1);
	});

	it('reuses the forward session for the same source message', async () => {
		const store = await load();
		const a = store.openForward({ source: 'm1', seed: 'm1' });
		store.openNew();
		expect(store.openForward({ source: 'm1', seed: 'm1' })).toBe(a);
		expect(store.openForward({ source: 'm1', seed: 'm2' })).not.toBe(a);
	});

	it('minimising leaves the draft open but unfocused', async () => {
		const store = await load();
		const a = store.openNew();
		store.minimize(a);
		expect(store.focused).toBeNull();
		expect(store.active).toBeNull();
		expect(store.sessions).toHaveLength(1);
	});

	it('closing one draft keeps the others', async () => {
		const store = await load();
		const a = store.openNew();
		const b = store.openDraft('d2');
		store.close(b);
		expect(store.sessions.map((s) => s.key)).toEqual([a]);
		expect(store.focused).toBeNull();
		store.closeDraft('missing');
		expect(store.sessions).toHaveLength(1);
	});

	it('closes a draft by id', async () => {
		const store = await load();
		store.openDraft('d3');
		store.closeDraft('d3');
		expect(store.open).toBe(false);
	});

	it('drops every draft when the account changes', async () => {
		const store = await load();
		store.setAccount('a1');
		store.openNew();
		store.openNew();
		store.setAccount('a1');
		expect(store.sessions).toHaveLength(2);
		store.setAccount('a2');
		expect(store.sessions).toHaveLength(0);
		expect(store.focused).toBeNull();
	});

	it('remembers the expanded size per device', async () => {
		let store = await load();
		expect(store.expanded).toBe(false);
		store.setExpanded(true);
		expect(storage.data.get(KEY)).toBe('1');
		store = await load();
		expect(store.expanded).toBe(true);
		store.setExpanded(false);
		expect(storage.data.has(KEY)).toBe(false);
	});

	it('works when storage is blocked', async () => {
		const blocked = () => {
			throw new Error('blocked');
		};
		vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
		const store = await load();
		expect(store.expanded).toBe(false);
		store.setExpanded(true);
		expect(store.expanded).toBe(true);
	});
});
