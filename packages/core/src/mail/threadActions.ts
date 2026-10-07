import {
	archiveMessage,
	getMessageThread,
	markMessageRead,
	markMessageSpam,
	moveMessage,
	moveMessageToInbox,
	restoreMessage,
	trashMessage
} from '$core/api/messages';
import type { MessageDetail, MessageState } from '$core/api/types';

export type ThreadVerb = 'archive' | 'trash' | 'restore' | 'read' | 'spam' | 'inbox' | 'move';

export interface ThreadActionResult {
	total: number;
	failed: number;
}

function eligible(item: MessageDetail, verb: ThreadVerb, folderId?: string): boolean {
	switch (verb) {
		case 'archive':
			return item.mailboxState === 'inbox' || item.mailboxState === 'folder';
		case 'trash':
			return item.mailboxState !== 'trash';
		case 'restore':
			return item.mailboxState === 'trash' || item.mailboxState === 'spam';
		case 'read':
			return !item.read;
		case 'spam':
			return item.mailboxState !== 'spam' && item.mailboxState !== 'trash';
		case 'inbox':
			return item.mailboxState !== 'inbox';
		case 'move':
			return (
				(item.mailboxState === 'inbox' ||
					item.mailboxState === 'archive' ||
					item.mailboxState === 'folder') &&
				item.folderId !== folderId
			);
	}
}

function actionFor(verb: ThreadVerb, folderId?: string): (id: string) => Promise<MessageState> {
	switch (verb) {
		case 'archive':
			return archiveMessage;
		case 'trash':
			return trashMessage;
		case 'restore':
			return restoreMessage;
		case 'read':
			return markMessageRead;
		case 'spam':
			return markMessageSpam;
		case 'inbox':
			return moveMessageToInbox;
		case 'move':
			return (id) => moveMessage(id, { folderId: folderId ?? '' });
	}
}

async function threadItems(latestId: string, rootId: string | undefined): Promise<MessageDetail[]> {
	try {
		return (await getMessageThread(latestId)).items;
	} catch (err) {
		if (!rootId || rootId === latestId) throw err;
		return (await getMessageThread(rootId)).items;
	}
}

export async function threadMessageIds(latestId: string, rootId: string | undefined): Promise<string[]> {
	return (await threadItems(latestId, rootId)).map((item) => item.id);
}

export async function threadTargets(
	latestId: string,
	rootId: string | undefined,
	verb: ThreadVerb,
	folderId?: string
): Promise<string[]> {
	const items = await threadItems(latestId, rootId);
	return items.filter((item) => eligible(item, verb, folderId)).map((item) => item.id);
}

export async function applyToThread(
	latestId: string,
	rootId: string | undefined,
	verb: ThreadVerb,
	folderId?: string
): Promise<ThreadActionResult> {
	const items = await threadItems(latestId, rootId);
	const action = actionFor(verb, folderId);
	const targets = items.filter((item) => eligible(item, verb, folderId)).map((item) => item.id);
	if (targets.length === 0) return { total: 0, failed: 0 };
	const results = await Promise.allSettled(targets.map((id) => action(id)));
	const failed = results.filter((r) => r.status === 'rejected').length;
	return { total: targets.length, failed };
}
