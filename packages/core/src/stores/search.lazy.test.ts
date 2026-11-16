import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loaded = vi.fn();
vi.mock('$core/search/ui', async (original) => {
	loaded();
	return original();
});
vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribeAccount: () => () => {} } }));

const focus = vi.fn(async () => {});
vi.mock('$core/search/lazy', () => ({
	searchSupported: () => true,
	searchRuntime: { focus: () => focus(), client: () => null, subscribePrefs: () => () => {} }
}));

async function fresh() {
	vi.resetModules();
	return (await import('./search.svelte')).mailSearch;
}

beforeEach(() => {
	loaded.mockClear();
	focus.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('mailSearch loading', () => {
	it('loads no search code when the account opens', async () => {
		const mailSearch = await fresh();
		const stop = mailSearch.start('acc-1');
		await vi.dynamicImportSettled();
		expect(loaded).not.toHaveBeenCalled();
		expect(focus).not.toHaveBeenCalled();
		stop();
	});

	it('loads on the first focus of the search field', async () => {
		const mailSearch = await fresh();
		const stop = mailSearch.start('acc-1');
		mailSearch.warm();
		await vi.dynamicImportSettled();
		expect(loaded).toHaveBeenCalledTimes(1);
		expect(focus).toHaveBeenCalledTimes(1);
		stop();
	});

	it('shows a committed query as starting, never as empty, while search loads', async () => {
		const mailSearch = await fresh();
		const stop = mailSearch.start('acc-1');
		mailSearch.commit('invoice');
		expect(mailSearch.active).toBe(true);
		expect(mailSearch.searching).toBe(true);
		expect(mailSearch.phase).toBe('starting');
		await vi.waitFor(() => expect(mailSearch.searching).toBe(false));
		expect(mailSearch.phase).toBe('failed');
		stop();
	});
});
