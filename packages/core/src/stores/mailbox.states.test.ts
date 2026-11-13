import { describe, it, expect, vi, beforeEach } from 'vitest';

const listMessages = vi.fn();
const listThreads = vi.fn();
const decryptPreview = vi.fn();
const getMessage = vi.fn();
const getMailboxCounts = vi.fn();

vi.mock('$core/api/messages', () => ({
	listMessages: (...a: unknown[]) => listMessages(...a),
	listThreads: (...a: unknown[]) => listThreads(...a),
	getMailboxCounts: (...a: unknown[]) => getMailboxCounts(...a),
	getMessage: (...a: unknown[]) => getMessage(...a)
}));

vi.mock('$core/mail/decrypt', () => ({
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
vi.mock('./auth.svelte', () => ({ auth: authState }));

const platformState = vi.hoisted(() => ({ mirror: undefined as unknown }));
vi.mock('$platform', () => ({ platform: platformState }));

import { mailbox } from './mailbox.svelte';
import { ApiCallError } from '$core/api/types';
import type { Query } from '$core/mail/url';

const SENT: Query = { folder: 'sent', labels: [], unread: false, attach: false, sort: 'newest' };

function row(id: string, storedAt = '2026-08-20T12:00:00Z', extra: Record<string, unknown> = {}) {
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
		labelIds: [],
		...extra
	};
}

function counts(inbox: number) {
	return { inbox, starred: 0, spam: 0, snoozed: 0, drafts: 0, folders: {}, labels: {} };
}

function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function apiError(status: number) {
	return new ApiCallError(status, { error: { code: 'x', message: `status ${status}` } } as never);
}

beforeEach(() => {
	listMessages.mockReset();
	listThreads.mockReset();
	getMessage.mockReset();
	getMailboxCounts.mockReset();
	decryptPreview.mockReset();
	decryptPreview.mockImplementation(async (_a: string, b64: string) => {
		const id = b64.replace('enc-', '');
		return {
			sender: { display: `S ${id}`, address: `${id}@example.com` },
			recipients: [{ kind: 'to', address: 'me@example.com' }],
			subject: `Subject ${id}`,
			snippet: ''
		};
	});
	authState.canEnterApp = true;
	authState.accountId = 'acc-1';
	platformState.mirror = undefined;
	mailbox.setAccount(null);
	mailbox.setAccount('acc-1');
});

describe('mailbox load states', () => {
	it('reports a stream it never fetched as not loaded rather than empty', () => {
		const s = mailbox.streamFor(SENT);
		expect(s.loaded).toBe(false);
		expect(s.msgs).toEqual([]);
	});

	it('is loading, then loaded and empty, and does not refetch an empty folder', async () => {
		const gate = Promise.withResolvers<{ items: unknown[]; nextCursor: null }>();
		listMessages.mockReturnValueOnce(gate.promise);
		const run = mailbox.ensureLoaded(SENT);
		expect(mailbox.streamFor(SENT).loading).toBe(true);
		expect(mailbox.streamFor(SENT).loaded).toBe(false);
		gate.resolve({ items: [], nextCursor: null });
		await run;
		expect(mailbox.streamFor(SENT)).toMatchObject({ loaded: true, loading: false, msgs: [] });
		await mailbox.ensureLoaded(SENT);
		expect(listMessages).toHaveBeenCalledTimes(1);
	});

	it('keeps a failed first load as an error and only refetches on retry', async () => {
		listMessages.mockRejectedValueOnce(new Error('offline'));
		await mailbox.ensureLoaded(SENT);
		expect(mailbox.streamFor(SENT)).toMatchObject({ loaded: false, loadError: 'offline' });
		await mailbox.ensureLoaded(SENT);
		expect(listMessages).toHaveBeenCalledTimes(1);
		listMessages.mockResolvedValueOnce({ items: [row('a')], nextCursor: null });
		await mailbox.retry(SENT);
		expect(mailbox.streamFor(SENT)).toMatchObject({ loaded: true, loadError: null });
		expect(mailbox.streamFor(SENT).msgs.map((m) => m.id)).toEqual(['a']);
	});

	it('keeps rows and marks the error when a refresh fails', async () => {
		listMessages.mockResolvedValueOnce({ items: [row('a')], nextCursor: null });
		await mailbox.ensureLoaded(SENT);
		const gate = Promise.withResolvers<never>();
		listMessages.mockReturnValueOnce(gate.promise);
		const run = mailbox.refresh([SENT]);
		expect(mailbox.streamFor(SENT)).toMatchObject({ refreshing: true, loading: false });
		gate.reject(new Error('down'));
		await run;
		const s = mailbox.streamFor(SENT);
		expect(s.msgs.map((m) => m.id)).toEqual(['a']);
		expect(s).toMatchObject({ loaded: true, refreshing: false, loadError: 'down' });
	});

	it('reports a failed next page separately from the list', async () => {
		listMessages.mockResolvedValueOnce({ items: [row('a')], nextCursor: 'c2' });
		await mailbox.ensureLoaded(SENT);
		listMessages.mockRejectedValueOnce(new Error('page'));
		await mailbox.loadMore(SENT);
		expect(mailbox.streamFor(SENT)).toMatchObject({ loadError: null, moreError: 'page', loadingMore: false });
	});
});

describe('mailbox races', () => {
	it('drops an older first page that lands after a newer one', async () => {
		const older = Promise.withResolvers<unknown>();
		listMessages.mockReturnValueOnce(older.promise);
		const first = mailbox.ensureLoaded(SENT);
		listMessages.mockResolvedValueOnce({ items: [row('new')], nextCursor: null });
		await mailbox.refresh([SENT]);
		older.resolve({ items: [row('old')], nextCursor: null });
		await first;
		expect(mailbox.streamFor(SENT).msgs.map((m) => m.id)).toEqual(['new']);
	});

	it('keeps an optimistic change made while a refresh was in flight', async () => {
		listMessages.mockResolvedValueOnce({ items: [row('a')], nextCursor: null });
		await mailbox.ensureLoaded(SENT);
		const gate = Promise.withResolvers<unknown>();
		listMessages.mockReturnValueOnce(gate.promise);
		const run = mailbox.refresh([SENT]);
		mailbox.patchMessage('a', { starred: true });
		gate.resolve({ items: [row('a', undefined, { starred: false })], nextCursor: null });
		await run;
		expect(mailbox.findMessage('a')?.starred).toBe(true);
	});

	it('does not bring back a row moved away while a refresh was in flight', async () => {
		listMessages.mockResolvedValueOnce({ items: [row('a'), row('b', '2026-08-19T12:00:00Z')], nextCursor: null });
		await mailbox.ensureLoaded(SENT);
		const gate = Promise.withResolvers<unknown>();
		listMessages.mockReturnValueOnce(gate.promise);
		const run = mailbox.refresh([SENT]);
		mailbox.patchMessage('a', { folder: 'trash' });
		gate.resolve({ items: [row('a'), row('b', '2026-08-19T12:00:00Z')], nextCursor: null });
		await run;
		expect(mailbox.streamFor(SENT).msgs.map((m) => m.id)).toEqual(['b']);
	});

	it('drops a page that lands after the account changed', async () => {
		const gate = Promise.withResolvers<unknown>();
		listMessages.mockReturnValueOnce(gate.promise);
		const run = mailbox.ensureLoaded(SENT);
		mailbox.setAccount('acc-2');
		gate.resolve({ items: [row('a')], nextCursor: null });
		await run;
		expect(mailbox.streamFor(SENT).loaded).toBe(false);
	});

	it('clears a stale next-page spinner when the first page reloads', async () => {
		listMessages.mockResolvedValueOnce({ items: [row('a')], nextCursor: 'c2' });
		await mailbox.ensureLoaded(SENT);
		const page = Promise.withResolvers<unknown>();
		listMessages.mockReturnValueOnce(page.promise);
		const more = mailbox.loadMore(SENT);
		listMessages.mockResolvedValueOnce({ items: [row('a')], nextCursor: 'c2' });
		await mailbox.refresh([SENT]);
		page.resolve({ items: [row('z', '2026-08-01T12:00:00Z')], nextCursor: null });
		await more;
		expect(mailbox.streamFor(SENT)).toMatchObject({ loadingMore: false });
		expect(mailbox.streamFor(SENT).msgs.map((m) => m.id)).toEqual(['a']);
	});
});

describe('mailbox message lookup', () => {
	it('tells a missing message from a failed fetch', async () => {
		getMessage.mockRejectedValueOnce(apiError(404));
		expect(await mailbox.resolveMessage('gone')).toEqual({ status: 'missing' });
		getMessage.mockRejectedValueOnce(new Error('network'));
		expect(await mailbox.resolveMessage('x')).toEqual({ status: 'error', error: 'network' });
	});
});

describe('mailbox counts', () => {
	it('fetches again when asked during a fetch, so the last answer wins', async () => {
		const first = Promise.withResolvers<unknown>();
		getMailboxCounts.mockReturnValueOnce(first.promise).mockResolvedValueOnce(counts(5));
		const a = mailbox.refreshCounts();
		const b = mailbox.refreshCounts();
		first.resolve(counts(9));
		await Promise.all([a, b]);
		await flush();
		expect(getMailboxCounts).toHaveBeenCalledTimes(2);
		expect(mailbox.counts.inbox).toBe(5);
	});

	it('moves the inbox badge with an optimistic read change', async () => {
		getMailboxCounts.mockResolvedValueOnce(counts(3));
		await mailbox.refreshCounts();
		const inbox: Query = { ...SENT, folder: 'inbox' };
		listThreads.mockResolvedValueOnce({
			items: [
				{
					threadKey: 'r1',
					latest: row('r1', undefined, { direction: 'received', read: false }),
					messageCount: 1,
					unreadCount: 1,
					starred: false,
					hasAttachments: false
				}
			],
			nextCursor: null
		});
		await mailbox.ensureLoaded(inbox);
		mailbox.patchMessage('r1', { unread: false });
		expect(mailbox.counts.inbox).toBe(2);
	});
});
