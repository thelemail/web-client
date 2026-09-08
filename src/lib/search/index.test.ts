import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageListItem } from '$lib/api/types';

const listMessages = vi.fn();
const listMessageChanges = vi.fn();
const decryptPreview = vi.fn();

vi.mock('$lib/api/messages', () => ({
	listMessages: (...a: unknown[]) => listMessages(...a),
	listMessageChanges: (...a: unknown[]) => listMessageChanges(...a)
}));

vi.mock('$lib/mail/decrypt', () => ({
	decryptPreview: (...a: unknown[]) => decryptPreview(...a)
}));

vi.mock('./seal', () => ({
	sealChunk: async (accountId: string, chunkId: number, texts: unknown[]) => ({
		accountId,
		chunkId,
		iv: new Uint8Array(12),
		ciphertext: new TextEncoder().encode(JSON.stringify(texts))
	}),
	openChunk: async (_accountId: string, chunk: { ciphertext: Uint8Array }) =>
		JSON.parse(new TextDecoder().decode(chunk.ciphertext)),
	SealError: class SealError extends Error {}
}));

import { memorySearchDb } from './db';
import { SearchIndex } from './index';

const ACCOUNT = 'acc-1';

function item(id: string, storedAt: string, over: Partial<MessageListItem> = {}): MessageListItem {
	return {
		id,
		ownerAccountId: ACCOUNT,
		direction: 'received',
		source: 'inbound_external',
		storedAt,
		bodySizeBytes: 0,
		attachmentCount: 0,
		totalAttachmentBytes: 0,
		encryptedPreview: `enc-${id}`,
		schemaVersion: 1,
		mailboxState: 'inbox',
		starred: false,
		read: true,
		labels: [],
		...over
	};
}

function preview(subject: string, address = 'someone@example.com', snippet = '') {
	return {
		v: 1,
		subject,
		sender: { display: address.split('@')[0], address },
		recipients: [{ display: 'Me', address: 'me@thelemail.com', kind: 'to' as const }],
		snippet,
		display_date: '2026-01-01T00:00:00Z'
	};
}

const NO_CHANGES = {
	changes: [],
	nextCursor: 'w0',
	hasMore: false,
	resyncRequired: false,
	watermark: '2026-01-01T00:00:00Z'
};

function inboxPages(...pages: { items: MessageListItem[]; nextCursor: string | null }[]) {
	let call = 0;
	listMessages.mockImplementation(async (opts: { mailbox?: string; direction?: string }) => {
		const isInbox = opts.mailbox === 'inbox' && opts.direction === 'received';
		if (!isInbox) return { items: [], nextCursor: null };
		const page = pages[Math.min(call, pages.length - 1)];
		call += 1;
		return page;
	});
}

beforeEach(() => {
	listMessages.mockReset();
	listMessageChanges.mockReset();
	decryptPreview.mockReset();
	listMessageChanges.mockResolvedValue(NO_CHANGES);
});

describe('SearchIndex backfill', () => {
	it('finds a subject that only exists on a later page', async () => {
		inboxPages(
			{
				items: Array.from({ length: 50 }, (_, i) => item(`old-${i}`, '2024-01-01T00:00:00Z')),
				nextCursor: 'c1'
			},
			{ items: [item('needle', '2024-06-01T00:00:00Z')], nextCursor: null }
		);
		decryptPreview.mockImplementation(async (_a: string, enc: string) =>
			enc === 'enc-needle' ? preview('Escola trip permission slip') : preview('Newsletter')
		);

		const index = new SearchIndex(memorySearchDb());
		await index.sync(ACCOUNT);

		const hits = index.search('permission slip');
		expect(hits.map((h) => h.row.id)).toEqual(['needle']);
	});

	it('indexes every message of a conversation, not just the newest', async () => {
		inboxPages({
			items: [
				item('older', '2024-01-01T00:00:00Z', { threadRootId: 'root' }),
				item('newest', '2024-02-01T00:00:00Z', { threadRootId: 'root' })
			],
			nextCursor: null
		});
		decryptPreview.mockImplementation(async (_a: string, enc: string) =>
			enc === 'enc-older'
				? preview('Re: invoice', 'accounts@supplier.pt')
				: preview('Re: invoice', 'anna@school.pt')
		);

		const index = new SearchIndex(memorySearchDb());
		await index.sync(ACCOUNT);

		const hits = index.search('accounts@supplier.pt');
		expect(hits.map((h) => h.row.id)).toEqual(['older']);
	});

	it('spans mailboxes other than the inbox', async () => {
		listMessages.mockImplementation(async (opts: { mailbox?: string }) => ({
			items: opts.mailbox === 'archive' ? [item('archived', '2024-03-01T00:00:00Z')] : [],
			nextCursor: null
		}));
		decryptPreview.mockResolvedValue(preview('Archived invoice'));

		const index = new SearchIndex(memorySearchDb());
		await index.sync(ACCOUNT);

		expect(index.search('archived invoice').map((h) => h.row.id)).toEqual(['archived']);
	});

	it('resumes an interrupted backfill from the stored cursor', async () => {
		const db = memorySearchDb();
		const isInbox = (o: { mailbox?: string; direction?: string }) =>
			o.mailbox === 'inbox' && o.direction === 'received';
		listMessages.mockImplementation(async (opts: { mailbox?: string; direction?: string; cursor?: string }) => {
			if (!isInbox(opts)) return { items: [], nextCursor: null };
			if (!opts.cursor) return { items: [item('a', '2024-01-01T00:00:00Z')], nextCursor: 'c1' };
			throw new Error('network down');
		});
		decryptPreview.mockResolvedValue(preview('First page'));

		const first = new SearchIndex(db);
		await expect(first.sync(ACCOUNT)).rejects.toThrow('network down');

		listMessages.mockImplementation(async (opts: { mailbox?: string; direction?: string; cursor?: string }) => {
			if (!isInbox(opts)) return { items: [], nextCursor: null };
			expect(opts.cursor).toBe('c1');
			return { items: [item('b', '2024-02-01T00:00:00Z')], nextCursor: null };
		});
		decryptPreview.mockResolvedValue(preview('Second page'));

		const second = new SearchIndex(db);
		await second.sync(ACCOUNT);

		expect(second.search('second page').map((h) => h.row.id)).toEqual(['b']);
		expect(second.search('first page').map((h) => h.row.id)).toEqual(['a']);
	});

	it('survives a preview it cannot decrypt', async () => {
		inboxPages({
			items: [item('broken', '2024-01-01T00:00:00Z'), item('fine', '2024-02-01T00:00:00Z')],
			nextCursor: null
		});
		decryptPreview.mockImplementation(async (_a: string, enc: string) => {
			if (enc === 'enc-broken') throw new Error('no matching key');
			return preview('Readable subject');
		});

		const index = new SearchIndex(memorySearchDb());
		await index.sync(ACCOUNT);

		expect(index.search('readable subject').map((h) => h.row.id)).toEqual(['fine']);
	});
});

describe('SearchIndex freshness', () => {
	it('picks up a message that only the change feed knows about', async () => {
		inboxPages({ items: [], nextCursor: null });
		listMessageChanges.mockResolvedValueOnce({
			...NO_CHANGES,
			changes: [
				{ id: 'fresh', updatedAt: '2026-01-02T00:00:00Z', deleted: false, message: item('fresh', '2026-01-02T00:00:00Z') }
			],
			nextCursor: 'w1'
		});
		decryptPreview.mockResolvedValue(preview('Just arrived'));

		const index = new SearchIndex(memorySearchDb());
		await index.sync(ACCOUNT);

		expect(index.search('just arrived').map((h) => h.row.id)).toEqual(['fresh']);
	});

	it('drops a message the change feed reports as deleted', async () => {
		inboxPages({ items: [item('doomed', '2024-01-01T00:00:00Z')], nextCursor: null });
		decryptPreview.mockResolvedValue(preview('Doomed invoice'));
		listMessageChanges.mockResolvedValueOnce({
			...NO_CHANGES,
			changes: [{ id: 'doomed', updatedAt: '2026-01-02T00:00:00Z', deleted: true }],
			nextCursor: 'w1'
		});

		const index = new SearchIndex(memorySearchDb());
		await index.sync(ACCOUNT);

		expect(index.search('doomed invoice')).toEqual([]);
	});

	it('rebuilds from scratch when the feed demands a resync', async () => {
		inboxPages({ items: [item('kept', '2024-01-01T00:00:00Z')], nextCursor: null });
		decryptPreview.mockResolvedValue(preview('Kept invoice'));
		listMessageChanges.mockResolvedValueOnce({
			...NO_CHANGES,
			resyncRequired: true,
			changes: []
		});

		const index = new SearchIndex(memorySearchDb());
		await index.sync(ACCOUNT);

		expect(index.search('kept invoice').map((h) => h.row.id)).toEqual(['kept']);
	});

	it('reports progress as complete only once every scope is exhausted', async () => {
		inboxPages({ items: [item('a', '2024-01-01T00:00:00Z')], nextCursor: null });
		decryptPreview.mockResolvedValue(preview('Anything'));

		const index = new SearchIndex(memorySearchDb());
		expect(index.progress.complete).toBe(false);
		await index.sync(ACCOUNT);
		expect(index.progress).toEqual({ indexed: 1, complete: true });
	});
});

describe('SearchIndex persistence', () => {
	it('searches from stored chunks without paging the archive again', async () => {
		const db = memorySearchDb();
		inboxPages({ items: [item('kept', '2024-01-01T00:00:00Z')], nextCursor: null });
		decryptPreview.mockResolvedValue(preview('Stored invoice'));

		const first = new SearchIndex(db);
		await first.sync(ACCOUNT);

		listMessages.mockClear();
		const reopened = new SearchIndex(db);
		await reopened.open(ACCOUNT);

		expect(listMessages).not.toHaveBeenCalled();
		expect(reopened.search('stored invoice').map((h) => h.row.id)).toEqual(['kept']);
	});
});
