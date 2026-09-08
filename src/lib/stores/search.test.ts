import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '$lib/search';

const indexSearch = vi.fn();
const indexSync = vi.fn(async () => {});
const indexClose = vi.fn();
const subscribers: ((p: { indexed: number; complete: boolean }) => void)[] = [];

vi.mock('$lib/search', () => ({
	searchIndex: {
		search: (...a: unknown[]) => indexSearch(...a),
		sync: (...a: unknown[]) => indexSync(...(a as [])),
		close: () => indexClose(),
		subscribe: (cb: (p: { indexed: number; complete: boolean }) => void) => {
			subscribers.push(cb);
			return () => {};
		},
		get progress() {
			return { indexed: 0, complete: false };
		}
	}
}));

const platformState = vi.hoisted(() => ({ mirror: undefined as unknown }));
vi.mock('$platform', () => ({ platform: platformState }));

import { mailSearch } from './search.svelte';

function result(id: string, subject: string, over: Partial<SearchResult['row']> = {}): SearchResult {
	return {
		row: {
			accountId: 'acc-1',
			id,
			chunkId: 0,
			storedAt: 1_700_000_000_000,
			direction: 'received',
			mailboxState: 'archive',
			read: true,
			starred: false,
			labels: [],
			attachmentCount: 0,
			threadRootId: null,
			snoozedUntil: null,
			...over
		},
		text: {
			id,
			subject,
			senderDisplay: 'Anna',
			senderAddress: 'anna@school.pt',
			recipients: 'me@thelemail.com',
			snippet: 'please sign'
		},
		excerpt: 'please sign',
		score: 10
	};
}

beforeEach(() => {
	indexSearch.mockReset();
	indexSync.mockClear();
	subscribers.length = 0;
	platformState.mirror = undefined;
	mailSearch.clear();
});

describe('mailSearch on the web build', () => {
	it('surfaces every index hit, whatever the mailbox has loaded', async () => {
		mailSearch.start('acc-1');
		indexSearch.mockReturnValue([result('never-loaded', 'Permission slip')]);

		mailSearch.setText('permission');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));

		expect(mailSearch.results[0].id).toBe('never-loaded');
		expect(mailSearch.results[0].subj).toBe('Permission slip');
	});

	it('files a hit under the folder its mailbox state names', async () => {
		mailSearch.start('acc-1');
		indexSearch.mockReturnValue([result('m1', 'Invoice', { mailboxState: 'archive' })]);

		mailSearch.setText('invoice');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));

		expect(mailSearch.results[0].folder).toBe('archive');
	});

	it('shows a sent hit as sent', async () => {
		mailSearch.start('acc-1');
		indexSearch.mockReturnValue([
			result('m1', 'Invoice', { mailboxState: 'inbox', direction: 'sent' })
		]);

		mailSearch.setText('invoice');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));

		expect(mailSearch.results[0].folder).toBe('sent');
	});

	it('is inactive and empty for a blank query', () => {
		mailSearch.start('acc-1');
		mailSearch.setText('   ');
		expect(mailSearch.active).toBe(false);
		expect(mailSearch.results).toEqual([]);
		expect(indexSearch).not.toHaveBeenCalled();
	});

	it('debounces rather than searching on every keystroke', async () => {
		mailSearch.start('acc-1');
		indexSearch.mockReturnValue([]);

		mailSearch.setText('i');
		mailSearch.setText('in');
		mailSearch.setText('inv');
		expect(indexSearch).not.toHaveBeenCalled();

		await vi.waitFor(() => expect(indexSearch).toHaveBeenCalledTimes(1));
		expect(indexSearch).toHaveBeenCalledWith('inv');
	});

	it('drops results from a query the user has moved on from', async () => {
		mailSearch.start('acc-1');
		indexSearch.mockReturnValue([result('stale', 'Stale')]);
		mailSearch.setText('stale');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));

		mailSearch.clear();
		expect(mailSearch.results).toEqual([]);
		expect(mailSearch.active).toBe(false);
	});

	it('re-runs the query as the index grows', async () => {
		mailSearch.start('acc-1');
		indexSearch.mockReturnValue([]);
		mailSearch.setText('invoice');
		await vi.waitFor(() => expect(indexSearch).toHaveBeenCalledTimes(1));

		indexSearch.mockReturnValue([result('late', 'Invoice 42')]);
		for (const cb of subscribers) cb({ indexed: 900, complete: false });

		expect(mailSearch.results.map((m) => m.id)).toEqual(['late']);
		expect(mailSearch.indexed).toBe(900);
	});

	it('reports the search as partial until the index is complete', async () => {
		mailSearch.start('acc-1');
		indexSearch.mockReturnValue([]);
		mailSearch.setText('invoice');
		await vi.waitFor(() => expect(indexSearch).toHaveBeenCalled());

		for (const cb of subscribers) cb({ indexed: 10, complete: false });
		expect(mailSearch.partial).toBe(true);

		for (const cb of subscribers) cb({ indexed: 20, complete: true });
		expect(mailSearch.partial).toBe(false);
	});
});

describe('mailSearch on the desktop build', () => {
	it('renders mirror hits the mailbox has never loaded', async () => {
		const search = vi.fn(async () => [
			{
				id: 'deep',
				subject: 'Permission slip',
				senderDisplay: 'Anna',
				senderAddress: 'anna@school.pt',
				snippet: 'please sign',
				excerpt: 'please sign',
				storedAt: '2024-01-01T00:00:00Z',
				mailboxState: 'archive',
				read: true,
				starred: false,
				attachmentCount: 0,
				threadRootId: null
			}
		]);
		platformState.mirror = { search };

		mailSearch.start('acc-1');
		mailSearch.setText('permission');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));

		expect(mailSearch.results[0].id).toBe('deep');
		expect(mailSearch.results[0].folder).toBe('archive');
		expect(search).toHaveBeenCalledWith('acc-1', 'permission', 200);
	});

	it('never builds a web index when a mirror is present', () => {
		platformState.mirror = { search: vi.fn(async () => []) };
		mailSearch.start('acc-1');
		expect(indexSync).not.toHaveBeenCalled();
	});
});
