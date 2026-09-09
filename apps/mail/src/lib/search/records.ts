import type { MessageListItem } from '$core/api/types';
import type { MessagePreview } from '$lib/mail/preview';
import { decodeWords } from 'postal-mime';
import type { IndexedRow, IndexedText } from './types';

export function rowFor(accountId: string, item: MessageListItem, chunkId: number): IndexedRow {
	return {
		accountId,
		id: item.id,
		chunkId,
		storedAt: new Date(item.storedAt).getTime(),
		direction: item.direction,
		mailboxState: item.mailboxState,
		read: item.read,
		starred: item.starred,
		labels: item.labels ?? [],
		attachmentCount: item.attachmentCount,
		threadRootId: item.threadRootId ?? null,
		snoozedUntil: item.snoozedUntil ?? null
	};
}

export function textFor(item: MessageListItem, preview: MessagePreview): IndexedText {
	return {
		id: item.id,
		subject: decodeWords(preview.subject || '') || '',
		senderDisplay: preview.sender.display || '',
		senderAddress: preview.sender.address || '',
		recipients: preview.recipients
			.map((r) => `${r.display} ${r.address}`.trim())
			.join(' ')
			.trim(),
		snippet: preview.snippet || ''
	};
}

export function undecryptableText(item: MessageListItem): IndexedText {
	return {
		id: item.id,
		subject: '',
		senderDisplay: '',
		senderAddress: '',
		recipients: '',
		snippet: ''
	};
}
