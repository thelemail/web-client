import { describe, it, expect, vi, beforeEach } from 'vitest';

const listMessages = vi.fn();
const listThreads = vi.fn();
const decryptPreview = vi.fn();
const getMessage = vi.fn();

vi.mock('$lib/api/messages', () => ({
	listMessages: (...a: unknown[]) => listMessages(...a),
	listThreads: (...a: unknown[]) => listThreads(...a),
	getMailboxCounts: vi.fn(async () => ({ inbox: 0, starred: 0, spam: 0, snoozed: 0 })),
	getMessage: (...a: unknown[]) => getMessage(...a)
}));

vi.mock('$lib/mail/decrypt', () => ({
	decryptPreview: (...a: unknown[]) => decryptPreview(...a),
	DecryptionError: class DecryptionError extends Error {
		code: string;
		constructor(code: string, message?: string) {
			super(message ?? code);
			this.code = code;
		}
	}
}));

const authState = vi.hoisted(() => ({ canEnterApp: true, accountId: 'acc-1' as string | null }));
vi.mock('./auth.svelte', () => ({
	auth: authState
}));

import { mailbox } from './mailbox.svelte';
import { DecryptionError } from '$lib/mail/decrypt';
import type { Query } from '$lib/mail/url';

const SENT_QUERY: Query = {
	folder: 'sent',
	labels: [],
	unread: false,
	attach: false,
	sort: 'newest'
};

function row(id: string, storedAt: string) {
	return {
		id,
		ownerAccountId: 'acc-1',
		direction: 'sent' as const,
		source: 'internal' as const,
		storedAt,
		bodySizeBytes: 0,
		attachmentCount: 0,
		totalAttachmentBytes: 0,
		encryptedPreview: `enc-${id}`,
		schemaVersion: 1,
		mailboxState: 'inbox' as const,
		starred: false,
		read: true,
		labels: []
	};
}

function flushAsync(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function previewFor(id: string) {
	return {
		sender: { display: `Sender ${id}`, address: `${id}@example.com` },
		recipients: [{ kind: 'to', address: 'me@example.com' }],
		subject: `Subject ${id}`,
		snippet: `Snippet ${id}`
	};
}

describe('mailbox pagination reconciliation on forced refresh', () => {
	beforeEach(() => {
		listMessages.mockReset();
		decryptPreview.mockReset();
		decryptPreview.mockImplementation(async (_accountId: string, b64: string) => {
			const id = b64.replace('enc-', '');
			return previewFor(id);
		});
		authState.canEnterApp = true;
		authState.accountId = 'acc-1';
		mailbox.setAccount(null);
		mailbox.setAccount('acc-1');
	});

	it('keeps deeper pages that are still older than the refreshed first page', async () => {
		listMessages.mockResolvedValueOnce({
			items: [row('p1a', '2026-08-20T12:00:00Z'), row('p1b', '2026-08-19T12:00:00Z')],
			nextCursor: 'cursor-2'
		});
		await mailbox.ensureLoaded(SENT_QUERY);

		listMessages.mockResolvedValueOnce({
			items: [row('p2a', '2026-08-18T12:00:00Z'), row('p2b', '2026-08-17T12:00:00Z')],
			nextCursor: null
		});
		await mailbox.loadMore(SENT_QUERY);

		expect(mailbox.streamFor(SENT_QUERY).msgs.map((m) => m.id)).toEqual([
			'p1a',
			'p1b',
			'p2a',
			'p2b'
		]);

		listMessages.mockResolvedValueOnce({
			items: [row('p1a', '2026-08-20T12:00:00Z'), row('p1b', '2026-08-19T12:00:00Z')],
			nextCursor: 'cursor-2'
		});
		await mailbox.refresh([SENT_QUERY]);

		expect(mailbox.streamFor(SENT_QUERY).msgs.map((m) => m.id)).toEqual([
			'p1a',
			'p1b',
			'p2a',
			'p2b'
		]);
	});

	it('drops a page-2 item that left the folder within the refreshed first page window', async () => {
		listMessages.mockResolvedValueOnce({
			items: [row('p1a', '2026-08-20T12:00:00Z'), row('p1b', '2026-08-19T12:00:00Z')],
			nextCursor: 'cursor-2'
		});
		await mailbox.ensureLoaded(SENT_QUERY);

		listMessages.mockResolvedValueOnce({
			items: [row('p2a', '2026-08-18T12:00:00Z')],
			nextCursor: null
		});
		await mailbox.loadMore(SENT_QUERY);

		listMessages.mockResolvedValueOnce({
			items: [
				row('p1a', '2026-08-20T12:00:00Z'),
				row('p1b', '2026-08-19T12:00:00Z'),
				row('new', '2026-08-18T13:00:00Z')
			],
			nextCursor: 'cursor-2'
		});
		await mailbox.refresh([SENT_QUERY]);

		expect(mailbox.streamFor(SENT_QUERY).msgs.map((m) => m.id)).toEqual([
			'p1a',
			'p1b',
			'new',
			'p2a'
		]);
	});

	it('lets a forced refresh proceed even while a normal load for the same stream is in flight', async () => {
		let resolveNormal: (v: unknown) => void = () => {};
		listMessages.mockImplementationOnce(
			() => new Promise((res) => (resolveNormal = res))
		);
		const normal = mailbox.ensureLoaded(SENT_QUERY);

		listMessages.mockResolvedValueOnce({
			items: [row('forced', '2026-08-20T12:00:00Z')],
			nextCursor: null
		});
		await mailbox.refresh([SENT_QUERY]);

		expect(mailbox.streamFor(SENT_QUERY).msgs.map((m) => m.id)).toEqual(['forced']);

		resolveNormal({ items: [row('stale', '2026-08-19T12:00:00Z')], nextCursor: null });
		await normal;
	});
});

const INBOX_QUERY: Query = {
	folder: 'sent',
	labels: [],
	unread: false,
	attach: false,
	sort: 'newest'
};

function detail(id: string, overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id,
		ownerAccountId: 'acc-1',
		direction: 'sent' as const,
		source: 'internal' as const,
		storedAt: '2026-08-20T12:00:00Z',
		encryptedPreview: `enc-${id}`,
		schemaVersion: 1,
		body: { url: 'https://example.com/body', expiresAt: '2026-08-20T13:00:00Z' },
		attachments: [],
		mailboxState: 'inbox' as const,
		starred: false,
		read: false,
		labels: [],
		...overrides
	};
}

describe('mailbox.applyRealtime in the inbox', () => {
	const MAILBOX_QUERY: Query = {
		folder: 'inbox',
		labels: [],
		unread: false,
		attach: false,
		sort: 'newest'
	};

	function received(id: string, storedAt: string, threadRootId?: string) {
		return { ...row(id, storedAt), direction: 'received' as const, read: false, threadRootId };
	}

	function thread(latest: ReturnType<typeof received>, messageCount: number) {
		return {
			threadKey: latest.threadRootId ?? latest.id,
			latest,
			messageCount,
			unreadCount: 1,
			hasAttachments: false,
			starred: false
		};
	}

	beforeEach(() => {
		listMessages.mockReset();
		listThreads.mockReset();
		decryptPreview.mockReset();
		getMessage.mockReset();
		decryptPreview.mockImplementation(async (_accountId: string, b64: string) => {
			const id = b64.replace('enc-', '');
			return previewFor(id);
		});
		authState.canEnterApp = true;
		authState.accountId = 'acc-1';
		mailbox.setAccount(null);
		mailbox.setAccount('acc-1');
	});

	it('does not open a row for a message the account just sent', async () => {
		listThreads.mockResolvedValueOnce({
			items: [thread(received('inb', '2026-08-19T12:00:00Z'), 1)],
			nextCursor: null
		});
		await mailbox.ensureLoaded(MAILBOX_QUERY);
		mailbox.setAutoFlush(MAILBOX_QUERY, true);

		getMessage.mockResolvedValueOnce(detail('outbound', { storedAt: '2026-08-20T12:00:00Z' }));
		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.created', id: 'outbound', rev: 1 });
		await flushAsync();

		expect(mailbox.streamFor(MAILBOX_QUERY).msgs.map((m) => m.id)).toEqual(['inb']);
		expect(mailbox.pendingFor(MAILBOX_QUERY)).toBe(0);
	});

	it('keeps a sent reply out of the buffer when auto-flush is off', async () => {
		listThreads.mockResolvedValueOnce({
			items: [thread(received('inb', '2026-08-19T12:00:00Z'), 1)],
			nextCursor: null
		});
		await mailbox.ensureLoaded(MAILBOX_QUERY);

		getMessage.mockResolvedValueOnce(detail('outbound', { storedAt: '2026-08-20T12:00:00Z' }));
		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.created', id: 'outbound', rev: 1 });
		await flushAsync();

		expect(mailbox.pendingFor(MAILBOX_QUERY)).toBe(0);
		mailbox.flushPending(MAILBOX_QUERY);
		expect(mailbox.streamFor(MAILBOX_QUERY).msgs.map((m) => m.id)).toEqual(['inb']);
	});

	it('refreshes the thread row when the reply belongs to a loaded conversation', async () => {
		listThreads.mockResolvedValueOnce({
			items: [thread(received('root', '2026-08-19T12:00:00Z', 'root'), 2)],
			nextCursor: null
		});
		await mailbox.ensureLoaded(MAILBOX_QUERY);
		expect(mailbox.streamFor(MAILBOX_QUERY).msgs[0].threadCount).toBe(2);

		getMessage.mockResolvedValueOnce(
			detail('reply', { storedAt: '2026-08-20T12:00:00Z', threadRootId: 'root', threadCount: 3 })
		);
		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.created', id: 'reply', rev: 1 });
		await flushAsync();

		const snap = mailbox.streamFor(MAILBOX_QUERY);
		expect(snap.msgs.map((m) => m.id)).toEqual(['reply']);
		expect(snap.msgs[0].threadCount).toBe(3);
	});

	it('still delivers the sent copy to the sent stream', async () => {
		listMessages.mockResolvedValueOnce({ items: [], nextCursor: null });
		await mailbox.ensureLoaded(SENT_QUERY);
		mailbox.setAutoFlush(SENT_QUERY, true);
		listThreads.mockResolvedValueOnce({
			items: [thread(received('inb', '2026-08-19T12:00:00Z'), 1)],
			nextCursor: null
		});
		await mailbox.ensureLoaded(MAILBOX_QUERY);

		getMessage.mockResolvedValueOnce(detail('outbound', { storedAt: '2026-08-20T12:00:00Z' }));
		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.created', id: 'outbound', rev: 1 });
		await flushAsync();

		expect(mailbox.streamFor(SENT_QUERY).msgs.map((m) => m.id)).toEqual(['outbound']);
		expect(mailbox.streamFor(MAILBOX_QUERY).msgs.map((m) => m.id)).toEqual(['inb']);
	});
});

describe('mailbox.applyRealtime', () => {
	beforeEach(() => {
		listMessages.mockReset();
		decryptPreview.mockReset();
		getMessage.mockReset();
		decryptPreview.mockImplementation(async (_accountId: string, b64: string) => {
			const id = b64.replace('enc-', '');
			return previewFor(id);
		});
		authState.canEnterApp = true;
		authState.accountId = 'acc-1';
		mailbox.setAccount(null);
		mailbox.setAccount('acc-1');
	});

	it('prepends a brand new message into a loaded newest-sort stream when auto-flush is on', async () => {
		listMessages.mockResolvedValueOnce({ items: [row('old', '2026-08-19T12:00:00Z')], nextCursor: null });
		await mailbox.ensureLoaded(INBOX_QUERY);
		mailbox.setAutoFlush(INBOX_QUERY, true);

		getMessage.mockResolvedValueOnce(detail('new1'));
		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.created', id: 'new1', rev: 1 });
		await flushAsync();

		expect(mailbox.streamFor(INBOX_QUERY).msgs.map((m) => m.id)).toEqual(['new1', 'old']);
	});

	it('buffers a brand new message instead of injecting it when auto-flush is off', async () => {
		listMessages.mockResolvedValueOnce({ items: [row('old', '2026-08-19T12:00:00Z')], nextCursor: null });
		await mailbox.ensureLoaded(INBOX_QUERY);

		getMessage.mockResolvedValueOnce(detail('new1'));
		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.created', id: 'new1', rev: 1 });
		await flushAsync();

		expect(mailbox.streamFor(INBOX_QUERY).msgs.map((m) => m.id)).toEqual(['old']);
		expect(mailbox.pendingFor(INBOX_QUERY)).toBe(1);

		mailbox.flushPending(INBOX_QUERY);
		expect(mailbox.streamFor(INBOX_QUERY).msgs.map((m) => m.id)).toEqual(['new1', 'old']);
		expect(mailbox.pendingFor(INBOX_QUERY)).toBe(0);
	});

	it('updates an existing row in place without buffering', async () => {
		listMessages.mockResolvedValueOnce({ items: [row('m1', '2026-08-19T12:00:00Z')], nextCursor: null });
		await mailbox.ensureLoaded(INBOX_QUERY);

		getMessage.mockResolvedValueOnce(detail('m1', { starred: true }));
		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.updated', id: 'm1', rev: 1 });
		await flushAsync();

		const snap = mailbox.streamFor(INBOX_QUERY);
		expect(snap.msgs.map((m) => m.id)).toEqual(['m1']);
		expect(snap.msgs[0].starred).toBe(true);
		expect(mailbox.pendingFor(INBOX_QUERY)).toBe(0);
	});

	it('removes a message on message.deleted from every loaded stream and the pin', async () => {
		listMessages.mockResolvedValueOnce({ items: [row('m1', '2026-08-19T12:00:00Z')], nextCursor: null });
		await mailbox.ensureLoaded(INBOX_QUERY);

		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.deleted', id: 'm1' });

		expect(mailbox.streamFor(INBOX_QUERY).msgs.map((m) => m.id)).toEqual([]);
		expect(getMessage).not.toHaveBeenCalled();
	});

	it('ignores a stale rev that does not exceed the last seen rev', async () => {
		listMessages.mockResolvedValueOnce({ items: [], nextCursor: null });
		await mailbox.ensureLoaded(INBOX_QUERY);
		mailbox.setAutoFlush(INBOX_QUERY, true);

		getMessage.mockResolvedValue(detail('m1'));
		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.updated', id: 'm1', rev: 5 });
		await flushAsync();
		expect(getMessage).toHaveBeenCalledTimes(1);

		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.updated', id: 'm1', rev: 5 });
		await Promise.resolve();
		expect(getMessage).toHaveBeenCalledTimes(1);

		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.updated', id: 'm1', rev: 6 });
		await flushAsync();
		expect(getMessage).toHaveBeenCalledTimes(2);
	});

	it('ignores a hint for a foreign account', async () => {
		listMessages.mockResolvedValueOnce({ items: [], nextCursor: null });
		await mailbox.ensureLoaded(INBOX_QUERY);

		mailbox.applyRealtime({ accountId: 'acc-999', kind: 'message.created', id: 'new1', rev: 1 });
		await Promise.resolve();

		expect(getMessage).not.toHaveBeenCalled();
	});

	it('does not insert a fallback row when the vault is locked', async () => {
		listMessages.mockResolvedValueOnce({ items: [], nextCursor: null });
		await mailbox.ensureLoaded(INBOX_QUERY);
		mailbox.setAutoFlush(INBOX_QUERY, true);

		getMessage.mockResolvedValueOnce(detail('locked1'));
		decryptPreview.mockImplementationOnce(async () => {
			throw new DecryptionError('locked');
		});

		mailbox.applyRealtime({ accountId: 'acc-1', kind: 'message.created', id: 'locked1', rev: 1 });
		await flushAsync();

		expect(mailbox.streamFor(INBOX_QUERY).msgs).toEqual([]);
		expect(mailbox.pendingFor(INBOX_QUERY)).toBe(0);
	});

	it('bumps the thread tick for a hinted thread_id', async () => {
		listMessages.mockResolvedValueOnce({ items: [], nextCursor: null });
		await mailbox.ensureLoaded(INBOX_QUERY);

		expect(mailbox.threadTick('t1')).toBe(0);

		getMessage.mockResolvedValueOnce(detail('m1'));
		mailbox.applyRealtime({
			accountId: 'acc-1',
			kind: 'message.updated',
			id: 'm1',
			thread_id: 't1',
			rev: 1
		});
		await flushAsync();

		expect(mailbox.threadTick('t1')).toBe(1);

		getMessage.mockResolvedValueOnce(detail('m1', { starred: true }));
		mailbox.applyRealtime({
			accountId: 'acc-1',
			kind: 'message.updated',
			id: 'm1',
			thread_id: 't1',
			rev: 2
		});
		await flushAsync();

		expect(mailbox.threadTick('t1')).toBe(2);
		expect(mailbox.threadTick('other-thread')).toBe(0);
	});

	it('does not bump the thread tick for a hint from a foreign account', async () => {
		mailbox.applyRealtime({
			accountId: 'acc-999',
			kind: 'message.updated',
			id: 'm1',
			thread_id: 't1',
			rev: 1
		});
		await Promise.resolve();

		expect(mailbox.threadTick('t1')).toBe(0);
	});
});

describe('mailbox.loadedQueries / refreshLoaded', () => {
	beforeEach(() => {
		listMessages.mockReset();
		decryptPreview.mockReset();
		getMessage.mockReset();
		decryptPreview.mockImplementation(async (_accountId: string, b64: string) => {
			const id = b64.replace('enc-', '');
			return previewFor(id);
		});
		authState.canEnterApp = true;
		authState.accountId = 'acc-1';
		mailbox.setAccount(null);
		mailbox.setAccount('acc-1');
	});

	it('reports the queries of every loaded stream and refreshes them all', async () => {
		const UNREAD_SENT: Query = { ...SENT_QUERY, unread: true };
		listMessages.mockResolvedValueOnce({ items: [row('a', '2026-08-25T12:00:00Z')], nextCursor: null });
		await mailbox.ensureLoaded(SENT_QUERY);
		listMessages.mockResolvedValueOnce({ items: [row('b', '2026-08-25T12:00:00Z')], nextCursor: null });
		await mailbox.ensureLoaded(UNREAD_SENT);

		expect(mailbox.loadedQueries()).toHaveLength(2);

		listMessages.mockResolvedValue({ items: [row('c', '2026-08-20T12:00:00Z')], nextCursor: null });
		await mailbox.refreshLoaded();

		expect(mailbox.streamFor(SENT_QUERY).msgs.map((m) => m.id)).toEqual(['c']);
		expect(mailbox.streamFor(UNREAD_SENT).msgs.map((m) => m.id)).toEqual(['c']);
	});
});

const RECEIVED_QUERY: Query = {
	folder: 'inbox',
	labels: [],
	unread: false,
	attach: false,
	sort: 'newest'
};

function receivedRow(id: string, storedAt: string) {
	return { ...row(id, storedAt), direction: 'received' as const, read: false };
}

function receivedThread(latest: ReturnType<typeof receivedRow>) {
	return {
		threadKey: latest.id,
		latest,
		messageCount: 1,
		unreadCount: 1,
		hasAttachments: false,
		starred: false
	};
}

describe('optimistic patches move rows out of the streams they no longer belong to', () => {
	beforeEach(() => {
		listMessages.mockReset();
		listThreads.mockReset();
		decryptPreview.mockReset();
		decryptPreview.mockImplementation(async (_accountId: string, b64: string) => {
			const id = b64.replace('enc-', '');
			return previewFor(id);
		});
		authState.canEnterApp = true;
		authState.accountId = 'acc-1';
		mailbox.setAccount(null);
		mailbox.setAccount('acc-1');
	});

	async function loadInbox() {
		listThreads.mockResolvedValueOnce({
			items: [
				receivedThread(receivedRow('a', '2026-08-20T12:00:00Z')),
				receivedThread(receivedRow('b', '2026-08-19T12:00:00Z')),
				receivedThread(receivedRow('c', '2026-08-18T12:00:00Z'))
			],
			nextCursor: null
		});
		await mailbox.ensureLoaded(RECEIVED_QUERY);
	}

	it('removes a message the moment it is patched into spam', async () => {
		await loadInbox();
		mailbox.patchMessage('b', { folder: 'spam' });
		expect(mailbox.streamFor(RECEIVED_QUERY).msgs.map((m) => m.id)).toEqual(['a', 'c']);
	});

	it('puts the message back in its old position when the patch is rolled back', async () => {
		await loadInbox();
		mailbox.patchMessage('b', { folder: 'spam' });
		mailbox.patchMessage('b', { folder: 'inbox' });
		expect(mailbox.streamFor(RECEIVED_QUERY).msgs.map((m) => m.id)).toEqual(['a', 'b', 'c']);
	});

	it('leaves a patch that does not change folder membership in place', async () => {
		await loadInbox();
		mailbox.patchMessage('b', { unread: true });
		const msgs = mailbox.streamFor(RECEIVED_QUERY).msgs;
		expect(msgs.map((m) => m.id)).toEqual(['a', 'b', 'c']);
		expect(msgs[1].unread).toBe(true);
	});

	it('keeps the open message readable after its row is dropped', async () => {
		await loadInbox();
		const pinned = mailbox.streamFor(RECEIVED_QUERY).msgs[1];
		mailbox.pin(pinned);
		mailbox.patchMessage('b', { folder: 'spam' });
		expect(mailbox.streamFor(RECEIVED_QUERY).msgs.map((m) => m.id)).toEqual(['a', 'c']);
		expect(mailbox.pinned?.id).toBe('b');
		expect(mailbox.pinned?.folder).toBe('spam');
	});
});
