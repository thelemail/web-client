import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const indexSearch = vi.fn();
const indexSync = vi.fn(async () => {});
const loaded = vi.fn();

vi.mock('$core/search', () => {
	loaded();
	return {
		searchIndex: {
			search: (...a: unknown[]) => indexSearch(...a),
			sync: (...a: unknown[]) => indexSync(...(a as [])),
			close: () => {},
			subscribe: () => () => {}
		}
	};
});
vi.mock('$platform', () => ({ platform: {} }));

function hit(id: string) {
	return {
		row: {
			accountId: 'acc-1',
			id,
			chunkId: 0,
			storedAt: 1_700_000_000_000,
			direction: 'received',
			mailboxState: 'inbox',
			read: true,
			starred: false,
			labels: [],
			attachmentCount: 0,
			threadRootId: null,
			snoozedUntil: null
		},
		text: { id, subject: 'Invoice', senderDisplay: 'Ada', senderAddress: 'ada@calloway.test', recipients: '', snippet: '' },
		excerpt: '',
		score: 1
	};
}

async function fresh() {
	vi.resetModules();
	return (await import('./search.svelte')).mailSearch;
}

beforeEach(() => {
	vi.useFakeTimers();
	indexSearch.mockReset();
	indexSync.mockClear();
	loaded.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('mailSearch loading', () => {
	it('loads nothing when the account opens', async () => {
		const mailSearch = await fresh();
		const stop = mailSearch.start('acc-1');
		await vi.advanceTimersByTimeAsync(100);
		expect(loaded).not.toHaveBeenCalled();
		expect(indexSync).not.toHaveBeenCalled();
		stop();
	});

	it('loads and syncs the index once the page is idle', async () => {
		const mailSearch = await fresh();
		const stop = mailSearch.start('acc-1');
		await vi.advanceTimersByTimeAsync(3000);
		await vi.dynamicImportSettled();
		expect(loaded).toHaveBeenCalledTimes(1);
		expect(indexSync).toHaveBeenCalledWith('acc-1');
		stop();
	});

	it('does not load after the account closes before idle', async () => {
		const mailSearch = await fresh();
		mailSearch.start('acc-1')();
		await vi.advanceTimersByTimeAsync(5000);
		expect(loaded).not.toHaveBeenCalled();
	});

	it('loads on the first focus of the search field', async () => {
		const mailSearch = await fresh();
		const stop = mailSearch.start('acc-1');
		mailSearch.warm();
		await vi.dynamicImportSettled();
		expect(indexSync).toHaveBeenCalledWith('acc-1');
		stop();
	});

	it('shows a committed query as searching until the index answers, never as empty', async () => {
		const mailSearch = await fresh();
		const stop = mailSearch.start('acc-1');
		indexSearch.mockReturnValue({ ok: true, results: [hit('m1')] });
		mailSearch.commit('invoice');
		expect(mailSearch.active).toBe(true);
		expect(mailSearch.searching).toBe(true);
		expect(mailSearch.failed).toBe(false);
		expect(indexSearch).not.toHaveBeenCalled();
		await vi.dynamicImportSettled();
		await vi.waitFor(() => expect(mailSearch.searching).toBe(false));
		expect(mailSearch.results.map((r) => r.id)).toEqual(['m1']);
		expect(mailSearch.committed).toBe('invoice');
		stop();
	});

	it('drops a query that was cleared while the index was loading', async () => {
		const mailSearch = await fresh();
		const stop = mailSearch.start('acc-1');
		indexSearch.mockReturnValue({ ok: true, results: [hit('m1')] });
		mailSearch.commit('invoice');
		mailSearch.clear();
		await vi.dynamicImportSettled();
		await vi.advanceTimersByTimeAsync(10);
		expect(indexSearch).not.toHaveBeenCalled();
		expect(mailSearch.results).toEqual([]);
		expect(mailSearch.searching).toBe(false);
		stop();
	});

	it('keeps the typed draft while the index loads and then fills the preview', async () => {
		const mailSearch = await fresh();
		const stop = mailSearch.start('acc-1');
		indexSearch.mockReturnValue({ ok: true, results: [hit('m1')] });
		mailSearch.setDraft('inv');
		expect(mailSearch.previewing).toBe(true);
		await vi.advanceTimersByTimeAsync(200);
		await vi.dynamicImportSettled();
		await vi.waitFor(() => expect(mailSearch.preview).toHaveLength(1));
		expect(mailSearch.draft).toBe('inv');
		expect(mailSearch.previewing).toBe(false);
		stop();
	});
});
