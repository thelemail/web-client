import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMessages = vi.fn();
const listThreads = vi.fn();

vi.mock('$core/api/messages', () => ({
	listMessages: (...a: unknown[]) => listMessages(...a),
	listThreads: (...a: unknown[]) => listThreads(...a),
	getMailboxCounts: vi.fn(async () => ({ inbox: 0, starred: 0, spam: 0, snoozed: 0, folders: {} })),
	getMessage: vi.fn()
}));

vi.mock('$core/mail/decrypt', () => ({
	decryptPreview: vi.fn(async (_a: string, b64: string) => ({
		sender: { display: b64, address: `${b64}@example.com` },
		recipients: [{ kind: 'to', address: 'me@example.com' }],
		subject: b64,
		snippet: b64
	})),
	DecryptionError: class extends Error {}
}));

vi.mock('./auth.svelte', () => ({ auth: { canEnterApp: true, accountId: 'acc-1' } }));

import { mailbox } from './mailbox.svelte';
import type { Query } from '$core/mail/url';

const FOLDER = '7d1f4c1e-3b2a-4c55-9a51-1f0e2d3c4b5a';
const LABEL = '0b8a6c2d-9e1f-4a3b-8c7d-6e5f4a3b2c1d';

function query(over: Partial<Query>): Query {
	return { folder: 'inbox', labels: [], unread: false, attach: false, sort: 'newest', ...over };
}

function filed(id: string) {
	return {
		id,
		ownerAccountId: 'acc-1',
		direction: 'received' as const,
		source: 'internal' as const,
		storedAt: '2026-10-01T12:00:00Z',
		bodySizeBytes: 0,
		attachmentCount: 0,
		totalAttachmentBytes: 0,
		encryptedPreview: id,
		schemaVersion: 1,
		mailboxState: 'folder' as const,
		folderId: FOLDER,
		labelIds: [LABEL],
		starred: false,
		read: false
	};
}

describe('custom folder streams', () => {
	beforeEach(() => {
		listThreads.mockReset();
		listMessages.mockReset();
		mailbox.setAccount(null);
		mailbox.setAccount('acc-1');
	});

	it('asks the server for the folder by id and keeps the folder and labels on each row', async () => {
		const q = query({ folder: `f-${FOLDER}`, labels: [LABEL] });
		listThreads.mockResolvedValueOnce({
			items: [
				{
					latest: filed('m1'),
					threadKey: 'm1',
					messageCount: 1,
					unreadCount: 1,
					hasAttachments: false,
					starred: false
				}
			],
			nextCursor: null
		});

		await mailbox.ensureLoaded(q);

		expect(listThreads).toHaveBeenCalledTimes(1);
		expect(listThreads.mock.calls[0][0]).toMatchObject({
			mailbox: 'folder',
			folderId: FOLDER,
			labelIds: [LABEL]
		});
		const [row] = mailbox.streamFor(q).msgs;
		expect(row.folder).toBe(`f-${FOLDER}`);
		expect(row.labels).toEqual([LABEL]);
	});

	it('drops a row from a folder stream once it is patched into another location', async () => {
		const q = query({ folder: `f-${FOLDER}` });
		listThreads.mockResolvedValueOnce({
			items: [
				{
					latest: filed('m1'),
					threadKey: 'm1',
					messageCount: 1,
					unreadCount: 1,
					hasAttachments: false,
					starred: false
				}
			],
			nextCursor: null
		});
		await mailbox.ensureLoaded(q);

		mailbox.patchMessage('m1', { folder: 'archive' });

		expect(mailbox.streamFor(q).msgs).toHaveLength(0);
	});
});
