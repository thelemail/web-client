import {
	archiveMessage,
	getMessageThread,
	markMessageRead,
	markMessageSpam,
	restoreMessage,
	trashMessage
} from '$lib/api/messages';
import type { MessageDetail, MessageState } from '$lib/api/types';

export type ThreadVerb = 'archive' | 'trash' | 'restore' | 'read' | 'spam' | 'inbox';

export interface ThreadActionResult {
	total: number;
	failed: number;
}

function eligible(item: MessageDetail, verb: ThreadVerb): boolean {
	switch (verb) {
		case 'archive':
			return item.mailboxState === 'inbox';
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
	}
}

function actionFor(verb: ThreadVerb): (id: string) => Promise<MessageState> {
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
			return restoreMessage;
	}
}

export async function applyToThread(
	latestId: string,
	rootId: string | undefined,
	verb: ThreadVerb
): Promise<ThreadActionResult> {
	let items: MessageDetail[];
	try {
		items = (await getMessageThread(latestId)).items;
	} catch (err) {
		if (!rootId || rootId === latestId) throw err;
		items = (await getMessageThread(rootId)).items;
	}
	const action = actionFor(verb);
	const targets = items.filter((item) => eligible(item, verb)).map((item) => item.id);
	if (targets.length === 0) return { total: 0, failed: 0 };
	const results = await Promise.allSettled(targets.map((id) => action(id)));
	const failed = results.filter((r) => r.status === 'rejected').length;
	return { total: targets.length, failed };
}
