import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'thelemail.mail.listWidth';

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
	return (await import('./mailPane.svelte')).mailPane;
}

const prop = () => document.documentElement.style.getPropertyValue('--mail-list-w');

beforeEach(() => {
	storage = memoryStorage();
	vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
	document.documentElement.style.removeProperty('--mail-list-w');
	vi.unstubAllGlobals();
});

describe('mailPane', () => {
	it('starts on the default width', async () => {
		const pane = await load();
		expect(pane.width).toBeNull();
		expect(prop()).toBe('');
	});

	it('restores a saved width on this device', async () => {
		storage.setItem(KEY, '412');
		const pane = await load();
		expect(pane.width).toBe(412);
		expect(prop()).toBe('412px');
	});

	it('ignores a saved width below the minimum or not a number', async () => {
		storage.setItem(KEY, '120');
		expect((await load()).width).toBeNull();
		storage.setItem(KEY, 'wide');
		expect((await load()).width).toBeNull();
	});

	it('saves, clamps to the minimum and resets', async () => {
		const pane = await load();
		pane.set(380.4);
		expect(storage.getItem(KEY)).toBe('380');
		pane.set(100);
		expect(pane.width).toBe(300);
		pane.reset();
		expect(pane.width).toBeNull();
		expect(storage.getItem(KEY)).toBeNull();
		expect(prop()).toBe('');
	});

	it('previews without saving', async () => {
		const pane = await load();
		pane.preview(500);
		expect(prop()).toBe('500px');
		expect(storage.getItem(KEY)).toBeNull();
		expect(pane.width).toBeNull();
	});

	it('still works when storage throws', async () => {
		const blocked = () => {
			throw new Error('blocked');
		};
		vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked });
		const pane = await load();
		expect(pane.width).toBeNull();
		pane.set(420);
		expect(pane.width).toBe(420);
		expect(prop()).toBe('420px');
		pane.reset();
		expect(prop()).toBe('');
	});
});
