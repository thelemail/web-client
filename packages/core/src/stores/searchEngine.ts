import { folderFromServer, type Message } from '$core/mail/data';
import { initialsFor } from '$core/mail/initials';
import { paletteFor } from '$core/mail/avatarPalette';
import { searchIndex, type SearchResult } from '$core/search';
import { collectionResolver, type CollectionResolver } from '$core/search/preview';
import { parseQuery } from '$core/search/query';
import type { ParsedQuery, QueryError, QueryNode } from '$core/search/query/ast';
import { queryErrorMessage } from '$core/search/query/messages';
import { conjuncts } from '$core/search/query/walk';
import { locale } from '$core/mail/locale.svelte';
import { m } from '$paraglide/messages.js';
import { mailCollections } from './mailCollections.svelte';

export interface Found {
	messages: Message[];
	error: QueryError | null;
}

export interface Progress {
	indexed: number;
	complete: boolean;
}

const TEXT_NODES = new Set<QueryNode['kind']>(['term', 'phrase', 'literal', 'prefix', 'and', 'or', 'around']);

function collections(): CollectionResolver {
	return collectionResolver(
		mailCollections.folders.filter((f) => !f.sealed),
		mailCollections.labels.filter((l) => !l.sealed),
		mailCollections.subtree
	);
}

function isChip(node: QueryNode): boolean {
	if (node.kind === 'not') return isChip(node.child);
	return !TEXT_NODES.has(node.kind);
}

function messageFromResult(result: SearchResult): Message {
	const { row, text } = result;
	const display = text.senderDisplay || text.senderAddress || m.mailbox_unknown_sender();
	const palette = paletteFor(text.senderAddress.toLowerCase());
	return {
		id: row.id,
		folder: folderFromServer(row.mailboxState, row.direction, row.folderId),
		direction: row.direction,
		from: display,
		fromAddr: text.senderAddress,
		to: text.recipients,
		recipients: [],
		init: initialsFor(display, text.senderAddress),
		bg: palette.bg,
		fg: palette.fg,
		epoch: row.storedAt,
		subj: text.subject || '(no subject)',
		labels: row.labels,
		unread: !row.read,
		starred: row.starred,
		snoozedUntil: row.snoozedUntil,
		prev: result.excerpt || text.snippet,
		body: [],
		threadRootId: row.threadRootId ?? undefined,
		attachments:
			row.attachmentCount > 0
				? new Array(row.attachmentCount).fill({ name: 'attachment', size: '' })
				: undefined
	};
}

export function parse(text: string): ReturnType<typeof parseQuery> {
	return parseQuery(text, { now: Date.now(), timeZone: locale.timeZone });
}

export function chipsOf(query: ParsedQuery, text: string): string[] {
	if (!query.root) return [];
	return conjuncts(query.root)
		.filter(isChip)
		.map((node) => text.slice(node.range.start, node.range.end));
}

export function errorMessage(error: QueryError): string {
	return queryErrorMessage(error);
}

export function find(query: ParsedQuery, limit: number): Found {
	const outcome = searchIndex.search(query, collections(), limit);
	if (!outcome.ok) return { messages: [], error: outcome.error };
	return { messages: outcome.results.map(messageFromResult), error: null };
}

export function subscribe(listener: (progress: Progress) => void): () => void {
	return searchIndex.subscribe(listener);
}

export function sync(accountId: string): Promise<void> {
	return searchIndex.sync(accountId);
}

export function close(): void {
	searchIndex.close();
}
