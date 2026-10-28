import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'thelemail.mail.listWidth';

async function load() {
	vi.resetModules();
	return (await import('./mailPane.svelte')).mailPane;
}

afterEach(() => {
	localStorage.clear();
	document.documentElement.style.removeProperty('--mail-list-w');
	vi.restoreAllMocks();
});

describe('mailPane', () => {
	it('starts on the default width', async () => {
		const pane = await load();
		expect(pane.width).toBeNull();
		expect(document.documentElement.style.getPropertyValue('--mail-list-w')).toBe('');
	});

	it('restores a saved width on this device', async () => {
		localStorage.setItem(KEY, '412');
		const pane = await load();
		expect(pane.width).toBe(412);
		expect(document.documentElement.style.getPropertyValue('--mail-list-w')).toBe('412px');
	});

	it('ignores a saved width below the minimum or not a number', async () => {
		localStorage.setItem(KEY, '120');
		expect((await load()).width).toBeNull();
		localStorage.setItem(KEY, 'wide');
		expect((await load()).width).toBeNull();
	});

	it('saves, clamps to the minimum and resets', async () => {
		const pane = await load();
		pane.set(380.4);
		expect(localStorage.getItem(KEY)).toBe('380');
		pane.set(100);
		expect(pane.width).toBe(300);
		pane.reset();
		expect(pane.width).toBeNull();
		expect(localStorage.getItem(KEY)).toBeNull();
		expect(document.documentElement.style.getPropertyValue('--mail-list-w')).toBe('');
	});

	it('previews without saving', async () => {
		const pane = await load();
		pane.preview(500);
		expect(document.documentElement.style.getPropertyValue('--mail-list-w')).toBe('500px');
		expect(localStorage.getItem(KEY)).toBeNull();
		expect(pane.width).toBeNull();
	});

	it('still works when storage throws', async () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('blocked');
		});
		const pane = await load();
		expect(pane.width).toBeNull();
		pane.set(420);
		expect(pane.width).toBe(420);
		expect(document.documentElement.style.getPropertyValue('--mail-list-w')).toBe('420px');
	});
});
