import { describe, it, expect, vi, beforeEach } from 'vitest';

const listMessages = vi.fn();
const decryptPreview = vi.fn();

vi.mock('$lib/api/messages', () => ({
	listMessages: (...a: unknown[]) => listMessages(...a),
	listThreads: vi.fn(),
	getMailboxCounts: vi.fn(async () => ({ inbox: 0, starred: 0, spam: 0, snoozed: 0 })),
	getMessage: vi.fn()
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
