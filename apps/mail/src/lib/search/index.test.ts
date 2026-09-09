import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageListItem } from '$core/api/types';

const listMessages = vi.fn();
const listMessageChanges = vi.fn();
const decryptPreview = vi.fn();

vi.mock('$core/api/messages', () => ({
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

describe('SearchIndex operators', () => {
	async function indexed(items: MessageListItem[], previews: Record<string, ReturnType<typeof preview>>) {
		listMessages.mockImplementation(async (opts: { mailbox?: string; direction?: string }) => {
			const isInbox = opts.mailbox === 'inbox' && opts.direction === 'received';
			const isSent = opts.mailbox === 'inbox' && opts.direction === 'sent';
			const isArchive = opts.mailbox === 'archive';
			return {
				items: items.filter((i) => {
					if (i.mailboxState === 'archive') return isArchive;
					return i.direction === 'sent' ? isSent : isInbox;
				}),
				nextCursor: null
			};
		});
		decryptPreview.mockImplementation(async (_a: string, enc: string) => previews[enc]);
		const index = new SearchIndex(memorySearchDb());
		await index.sync(ACCOUNT);
		return index;
	}

	it('narrows free text by sender', async () => {
		const index = await indexed(
			[item('a', '2024-01-01T00:00:00Z'), item('b', '2024-02-01T00:00:00Z')],
			{
				'enc-a': preview('Invoice 42', 'anna@school.pt'),
				'enc-b': preview('Invoice 43', 'bob@other.pt')
			}
		);
		expect(index.search('invoice').map((h) => h.row.id).sort()).toEqual(['a', 'b']);
		expect(index.search('invoice from:anna').map((h) => h.row.id)).toEqual(['a']);
		expect(index.search('invoice from:school').map((h) => h.row.id)).toEqual(['a']);
	});

	it('narrows by unread', async () => {
		const index = await indexed(
			[
				item('read', '2024-01-01T00:00:00Z', { read: true }),
				item('unread', '2024-02-01T00:00:00Z', { read: false })
			],
			{ 'enc-read': preview('Invoice'), 'enc-unread': preview('Invoice') }
		);
		expect(index.search('invoice is:unread').map((h) => h.row.id)).toEqual(['unread']);
		expect(index.search('invoice is:read').map((h) => h.row.id)).toEqual(['read']);
	});

	it('tells sent from inbox', async () => {
		const index = await indexed(
			[
				item('in', '2024-01-01T00:00:00Z', { direction: 'received' }),
				item('out', '2024-02-01T00:00:00Z', { direction: 'sent' })
			],
			{ 'enc-in': preview('Invoice'), 'enc-out': preview('Invoice') }
		);
		expect(index.search('invoice in:sent').map((h) => h.row.id)).toEqual(['out']);
		expect(index.search('invoice in:inbox').map((h) => h.row.id)).toEqual(['in']);
	});

	it('narrows by attachments and by star', async () => {
		const index = await indexed(
			[
				item('plain', '2024-01-01T00:00:00Z'),
				item('withatt', '2024-02-01T00:00:00Z', { attachmentCount: 2, starred: true })
			],
			{ 'enc-plain': preview('Invoice'), 'enc-withatt': preview('Invoice') }
		);
		expect(index.search('invoice has:attachment').map((h) => h.row.id)).toEqual(['withatt']);
		expect(index.search('invoice is:starred').map((h) => h.row.id)).toEqual(['withatt']);
	});

	it('answers a filter-only query newest first', async () => {
		const index = await indexed(
			[
				item('old', '2024-01-01T00:00:00Z', { read: false }),
				item('new', '2024-06-01T00:00:00Z', { read: false }),
				item('seen', '2024-07-01T00:00:00Z', { read: true })
			],
			{
				'enc-old': preview('One'),
				'enc-new': preview('Two'),
				'enc-seen': preview('Three')
			}
		);
		expect(index.search('is:unread').map((h) => h.row.id)).toEqual(['new', 'old']);
	});

	it('returns nothing for a query that parses to nothing', async () => {
		const index = await indexed([item('a', '2024-01-01T00:00:00Z')], {
			'enc-a': preview('Invoice')
		});
		expect(index.search('()')).toEqual([]);
		expect(index.search('   ')).toEqual([]);
	});

	it('returns nothing for a folder it does not know', async () => {
		const index = await indexed([item('a', '2024-01-01T00:00:00Z')], {
			'enc-a': preview('Invoice')
		});
		expect(index.search('invoice in:nowhere')).toEqual([]);
	});

	it('combines operators', async () => {
		const index = await indexed(
			[
				item('hit', '2024-02-01T00:00:00Z', { read: false, attachmentCount: 1 }),
				item('wrongsender', '2024-03-01T00:00:00Z', { read: false, attachmentCount: 1 }),
				item('alreadyread', '2024-04-01T00:00:00Z', { read: true, attachmentCount: 1 })
			],
			{
				'enc-hit': preview('Invoice', 'anna@school.pt'),
				'enc-wrongsender': preview('Invoice', 'bob@other.pt'),
				'enc-alreadyread': preview('Invoice', 'anna@school.pt')
			}
		);
		expect(index.search('invoice from:anna is:unread has:attachment').map((h) => h.row.id)).toEqual(
			['hit']
		);
	});
});
