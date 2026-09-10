import type { MailboxState, MessageDirection } from '$core/api/types';

export interface IndexedRow {
	accountId: string;
	id: string;
	chunkId: number;
	storedAt: number;
	direction: MessageDirection;
	mailboxState: MailboxState;
	read: boolean;
	starred: boolean;
	labels: string[];
	attachmentCount: number;
	threadRootId: string | null;
	snoozedUntil: string | null;
}

export interface IndexedText {
	id: string;
	subject: string;
	senderDisplay: string;
	senderAddress: string;
	recipients: string;
	snippet: string;
}

export interface IndexChunk {
	accountId: string;
	chunkId: number;
	iv: Uint8Array;
	ciphertext: Uint8Array;
}

export type ScopeId = 'inbox' | 'sent' | 'archive' | 'spam' | 'trash' | 'snoozed';

export const SCOPES: readonly ScopeId[] = [
	'inbox',
	'sent',
	'archive',
	'spam',
	'trash',
	'snoozed'
];

export interface ScopeProgress {
	cursor: string | null;
	done: boolean;
}

export interface IndexMeta {
	accountId: string;
	scopes: Partial<Record<ScopeId, ScopeProgress>>;
	changesCursor: string | null;
	nextChunkId: number;
	indexedCount: number;
	updatedAt: number;
}

export function emptyMeta(accountId: string): IndexMeta {
	return {
		accountId,
		scopes: {},
		changesCursor: null,
		nextChunkId: 0,
		indexedCount: 0,
		updatedAt: 0
	};
}

export function backfillComplete(meta: IndexMeta): boolean {
	return SCOPES.every((scope) => meta.scopes[scope]?.done === true);
}
