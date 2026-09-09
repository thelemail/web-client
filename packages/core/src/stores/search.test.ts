import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '$core/search';

const indexSearch = vi.fn();
const indexSync = vi.fn(async () => {});
const indexClose = vi.fn();
const subscribers: ((p: { indexed: number; complete: boolean }) => void)[] = [];

vi.mock('$core/search', () => ({
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

describe('mailSearch filter chips', () => {
	it('names the filters the query applied', () => {
		mailSearch.start('acc-1');
		indexSearch.mockReturnValue([]);
		mailSearch.setText('invoice from:anna is:unread has:attachment in:sent');
		expect(mailSearch.chips).toEqual([
			'from:anna',
			'in:sent',
			'unread',
			'has attachment'
		]);
	});

	it('shows an unrecognised folder rather than hiding it', () => {
		mailSearch.start('acc-1');
		indexSearch.mockReturnValue([]);
		mailSearch.setText('in:nowhere');
		expect(mailSearch.chips).toEqual(['in:nowhere']);
	});

	it('has no chips for plain free text', () => {
		mailSearch.start('acc-1');
		indexSearch.mockReturnValue([]);
		mailSearch.setText('invoice');
		expect(mailSearch.chips).toEqual([]);
	});
});

describe('mailSearch across accounts', () => {
	it('drops the previous account results when the account changes', async () => {
		const stop = mailSearch.start('acc-1');
		indexSearch.mockReturnValue([result('from-acc-1', 'Invoice')]);
		mailSearch.setText('invoice');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));

		stop();
		mailSearch.start('acc-2');

		expect(mailSearch.text).toBe('');
		expect(mailSearch.results).toEqual([]);
		expect(mailSearch.active).toBe(false);
	});

	it('builds the index for the account it was restarted with', async () => {
		mailSearch.start('acc-1');
		await vi.waitFor(() => expect(indexSync).toHaveBeenCalledWith('acc-1'));

		indexSync.mockClear();
		mailSearch.start('acc-2');
		await vi.waitFor(() => expect(indexSync).toHaveBeenCalledWith('acc-2'));
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

	it('forwards the operator query to the mirror untouched', async () => {
		const search = vi.fn(async () => []);
		platformState.mirror = { search };
		mailSearch.start('acc-1');
		mailSearch.setText('invoice from:anna is:unread');
		await vi.waitFor(() => expect(search).toHaveBeenCalled());
		expect(search).toHaveBeenCalledWith('acc-1', 'invoice from:anna is:unread', 200);
	});

	it('files a sent hit as sent when the mirror reports its direction', async () => {
		const search = vi.fn(async () => [
			{
				id: 'out',
				subject: 'Invoice',
				senderDisplay: 'Me',
				senderAddress: 'me@thelemail.com',
				snippet: '',
				excerpt: '',
				storedAt: '2024-01-01T00:00:00Z',
				mailboxState: 'inbox',
				direction: 'sent' as const,
				read: true,
				starred: false,
				attachmentCount: 0,
				threadRootId: null
			}
		]);
		platformState.mirror = { search };
		mailSearch.start('acc-1');
		mailSearch.setText('invoice');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		expect(mailSearch.results[0].folder).toBe('sent');
		expect(mailSearch.results[0].direction).toBe('sent');
	});

	it('falls back to received when an older binary omits the direction', async () => {
		const search = vi.fn(async () => [
			{
				id: 'old',
				subject: 'Invoice',
				senderDisplay: 'Anna',
				senderAddress: 'anna@school.pt',
				snippet: '',
				excerpt: '',
				storedAt: '2024-01-01T00:00:00Z',
				mailboxState: 'inbox',
				read: true,
				starred: false,
				attachmentCount: 0,
				threadRootId: null
			}
		]);
		platformState.mirror = { search };
		mailSearch.start('acc-1');
		mailSearch.setText('invoice');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		expect(mailSearch.results[0].folder).toBe('inbox');
	});

	it('never builds a web index when a mirror is present', () => {
		platformState.mirror = { search: vi.fn(async () => []) };
		mailSearch.start('acc-1');
		expect(indexSync).not.toHaveBeenCalled();
	});
});
