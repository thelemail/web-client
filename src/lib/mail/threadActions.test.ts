import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/api/messages', () => ({
	getMessageThread: vi.fn(),
	archiveMessage: vi.fn(),
	trashMessage: vi.fn(),
	restoreMessage: vi.fn(),
	markMessageRead: vi.fn(),
	markMessageSpam: vi.fn()
}));

import {
	archiveMessage,
	getMessageThread,
	markMessageRead,
	markMessageSpam,
	restoreMessage,
	trashMessage
} from '$lib/api/messages';
import type { MailboxState, MessageDetail } from '$lib/api/types';
import { applyToThread } from './threadActions';

const getThread = vi.mocked(getMessageThread);
const archive = vi.mocked(archiveMessage);
const trash = vi.mocked(trashMessage);
const restore = vi.mocked(restoreMessage);
const read = vi.mocked(markMessageRead);
const spam = vi.mocked(markMessageSpam);

function item(id: string, mailboxState: MailboxState, isRead = true): MessageDetail {
	return { id, mailboxState, read: isRead } as MessageDetail;
}

function thread(...items: MessageDetail[]) {
	getThread.mockResolvedValue({ threadRootId: items[0]?.id ?? 'root', items });
}

const okState = (id: string) =>
	Promise.resolve({ id, mailboxState: 'inbox' as const, starred: false, read: true });

beforeEach(() => {
	vi.resetAllMocks();
	for (const fn of [archive, trash, restore, read, spam]) {
		fn.mockImplementation(okState);
	}
});

describe('applyToThread', () => {
	it('archives only inbox messages, leaving trash and spam alone', async () => {
		thread(item('a', 'inbox'), item('b', 'archive'), item('c', 'trash'), item('d', 'spam'));
		const res = await applyToThread('a', 'a', 'archive');
		expect(res).toEqual({ total: 1, failed: 0 });
		expect(archive).toHaveBeenCalledTimes(1);
		expect(archive).toHaveBeenCalledWith('a');
	});

	it('trashes every message not already in trash', async () => {
		thread(item('a', 'inbox'), item('b', 'archive'), item('c', 'trash'));
		const res = await applyToThread('a', 'a', 'trash');
		expect(res).toEqual({ total: 2, failed: 0 });
		expect(trash.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b']);
	});

	it('restores only trash and spam messages', async () => {
		thread(item('a', 'inbox'), item('b', 'trash'), item('c', 'spam'));
		const res = await applyToThread('b', 'a', 'restore');
		expect(res).toEqual({ total: 2, failed: 0 });
		expect(restore.mock.calls.map((c) => c[0]).sort()).toEqual(['b', 'c']);
	});

	it('marks only unread messages read and no-ops on a fully read thread', async () => {
		thread(item('a', 'inbox', false), item('b', 'inbox', true), item('c', 'archive', false));
		expect(await applyToThread('a', 'a', 'read')).toEqual({ total: 2, failed: 0 });
		expect(read.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'c']);

		read.mockClear();
		thread(item('a', 'inbox', true));
		expect(await applyToThread('a', 'a', 'read')).toEqual({ total: 0, failed: 0 });
		expect(read).not.toHaveBeenCalled();
	});

	it('marks inbox and archive messages as spam, skipping spam and trash', async () => {
		thread(item('a', 'inbox'), item('b', 'archive'), item('c', 'spam'), item('d', 'trash'));
		const res = await applyToThread('a', 'a', 'spam');
		expect(res).toEqual({ total: 2, failed: 0 });
		expect(spam.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b']);
	});

	it('moves every message out of archive, trash and spam back to the inbox', async () => {
		thread(item('a', 'archive'), item('b', 'trash'), item('c', 'spam'), item('d', 'inbox'));
		const res = await applyToThread('a', 'a', 'inbox');
		expect(res).toEqual({ total: 3, failed: 0 });
		expect(restore.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b', 'c']);
	});

	it('counts per-message failures without rejecting', async () => {
		thread(item('a', 'inbox'), item('b', 'inbox'));
		archive.mockImplementation((id) =>
			id === 'b' ? Promise.reject(new Error('boom')) : okState(id)
		);
		const res = await applyToThread('a', 'a', 'archive');
		expect(res).toEqual({ total: 2, failed: 1 });
	});

	it('falls back to the root id when the latest id fails to load', async () => {
		getThread.mockRejectedValueOnce(new Error('not found'));
		getThread.mockResolvedValueOnce({ threadRootId: 'root', items: [item('root', 'inbox')] });
		const res = await applyToThread('latest', 'root', 'archive');
		expect(res).toEqual({ total: 1, failed: 0 });
		expect(getThread).toHaveBeenNthCalledWith(1, 'latest');
		expect(getThread).toHaveBeenNthCalledWith(2, 'root');
	});

	it('rethrows the load failure when no distinct root id exists', async () => {
		getThread.mockRejectedValue(new Error('not found'));
		await expect(applyToThread('latest', 'latest', 'archive')).rejects.toThrow('not found');
		await expect(applyToThread('latest', undefined, 'archive')).rejects.toThrow('not found');
	});
});
