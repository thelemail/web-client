import { beforeEach, describe, expect, it, vi } from 'vitest';

const listMessages = vi.fn();
const listThreads = vi.fn();

vi.mock('$core/api/messages', () => ({
	listMessages: (...a: unknown[]) => listMessages(...a),
	listThreads: (...a: unknown[]) => listThreads(...a),
	getMailboxCounts: vi.fn(async () => ({
		inbox: 0,
		starred: 0,
		spam: 0,
		snoozed: 0,
		folders: {},
		labels: {}
	})),
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
import { mailCollections } from './mailCollections.svelte';
import { ApiCallError } from '$core/api/types';
import type { Query } from '$core/mail/url';
import type { CollectionNode } from '$core/mail/collections/tree';

const FOLDER = '7d1f4c1e-3b2a-4c55-9a51-1f0e2d3c4b5a';
const CHILD = '3c9e1b7a-2d4f-4e6a-8b1c-5d7e9f0a1b2c';
const LABEL = '0b8a6c2d-9e1f-4a3b-8c7d-6e5f4a3b2c1d';

function query(over: Partial<Query>): Query {
	return {
		folder: 'inbox',
		labels: [],
		unread: false,
		attach: false,
		sort: 'newest',
		direct: false,
		...over
	};
}

function node(id: string, kind: 'folder' | 'label', parentId: string | null = null): CollectionNode {
	return { id, kind, parentId, position: 1024, rev: 1, name: id.slice(0, 4), color: null, favorite: false, sealed: false };
}

function thread(item: ReturnType<typeof filed>) {
	return {
		latest: item,
		threadKey: item.id,
		messageCount: 1,
		unreadCount: 1,
		hasAttachments: false,
		starred: false
	};
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
		mailCollections.nodes = [node(FOLDER, 'folder'), node(CHILD, 'folder', FOLDER), node(LABEL, 'label')];
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
			folderId: FOLDER,
			labelIds: [LABEL]
		});
		expect(listThreads.mock.calls[0][0].mailbox).toBeUndefined();
		expect(listThreads.mock.calls[0][0].descendants).toBeUndefined();
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

	it('opens a label across mailboxes and ignores label chips inside it', async () => {
		const q = query({ folder: `l-${LABEL}`, labels: [FOLDER] });
		listThreads.mockResolvedValueOnce({ items: [thread(filed('m1'))], nextCursor: null });

		await mailbox.ensureLoaded(q);

		const opts = listThreads.mock.calls[0][0];
		expect(opts.labelIds).toEqual([LABEL]);
		expect(opts.mailbox).toBeUndefined();
		expect(opts.folderId).toBeUndefined();
		expect(mailbox.streamFor(q).msgs).toHaveLength(1);
	});

	it('asks for direct mail only when the view is scoped to the folder itself', async () => {
		const q = query({ folder: `f-${FOLDER}`, direct: true });
		listThreads.mockResolvedValueOnce({ items: [], nextCursor: null });

		await mailbox.ensureLoaded(q);

		expect(listThreads.mock.calls[0][0]).toMatchObject({ folderId: FOLDER, descendants: false });
	});

	it('keeps mail moved into a subfolder in the parent view unless it is scoped to direct mail', async () => {
		const subtree = query({ folder: `f-${FOLDER}` });
		const direct = query({ folder: `f-${FOLDER}`, direct: true });
		listThreads
			.mockResolvedValueOnce({ items: [thread(filed('m1'))], nextCursor: null })
			.mockResolvedValueOnce({ items: [thread(filed('m1'))], nextCursor: null });
		await mailbox.ensureLoaded(subtree);
		await mailbox.ensureLoaded(direct);

		mailbox.patchMessage('m1', { folder: `f-${CHILD}`, folderId: CHILD });

		expect(mailbox.streamFor(subtree).msgs).toHaveLength(1);
		expect(mailbox.streamFor(direct).msgs).toHaveLength(0);
	});

	it('drops a labelled row from the label view when it is trashed', async () => {
		const q = query({ folder: `l-${LABEL}` });
		listThreads.mockResolvedValueOnce({ items: [thread(filed('m1'))], nextCursor: null });
		await mailbox.ensureLoaded(q);

		mailbox.patchMessage('m1', { folder: 'trash' });

		expect(mailbox.streamFor(q).msgs).toHaveLength(0);
	});

	it('marks the stream missing when the folder was deleted elsewhere', async () => {
		const q = query({ folder: `f-${FOLDER}` });
		listThreads.mockRejectedValueOnce(new ApiCallError(404, null, 'folder or label not found'));

		await mailbox.ensureLoaded(q);

		const snap = mailbox.streamFor(q);
		expect(snap.missing).toBe(true);
		expect(snap.loadError).toBeNull();
	});
});
