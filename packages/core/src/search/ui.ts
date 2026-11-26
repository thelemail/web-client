import { folderFromServer, type Message, type SearchMatch } from '$core/mail/data';
import { customFolderRoute } from '$core/mail/folderRoute';
import { initialsFor } from '$core/mail/initials';
import { paletteFor } from '$core/mail/avatarPalette';
import { locale } from '$core/mail/locale.svelte';
import { addresses } from '$core/stores/addresses.svelte';
import { mailCollections } from '$core/stores/mailCollections.svelte';
import { m } from '$paraglide/messages.js';
import { parseQuery } from './query';
import type { QueryError } from './query/ast';
import { queryErrorMessage } from './query/messages';
import type { QueryContext } from './sqlite/compile';
import type { ResultRow } from './sqlite/run';
import { Field, Flag, SourceKind } from './sqlite/types';

export { chipsOf, replaceRange, type Chip } from './chips';
export { coverageOf, progressOf } from './coverage';
export { relatedAllowed } from './query/classify';
export { RelatedRun } from './related.svelte';

export function parse(text: string): ReturnType<typeof parseQuery> {
	return parseQuery(text, { now: Date.now(), timeZone: locale.timeZone });
}

export function errorMessage(error: QueryError): string {
	return queryErrorMessage(error);
}

export function contextFor(options: { exactFolders: boolean; attachmentText: boolean }): QueryContext {
	const identities = addresses.items.map((a) => a.email);
	const folders: { id: string; path: string }[] = [];
	for (const f of mailCollections.folders) {
		if (f.sealed) continue;
		folders.push({ id: f.id, path: f.path });
		if (f.path !== f.name) folders.push({ id: f.id, path: f.name });
	}
	const labels: { id: string; name: string }[] = [];
	for (const l of mailCollections.labels) {
		if (l.sealed) continue;
		labels.push({ id: l.id, name: l.path });
		if (l.path !== l.name) labels.push({ id: l.id, name: l.name });
	}
	return { identities, folders, labels, attachmentText: options.attachmentText, exactFolders: options.exactFolders };
}

const KIND_NAME: Record<number, SearchMatch['kind']> = {
	[SourceKind.message]: 'message',
	[SourceKind.draft]: 'draft',
	[SourceKind.scheduled]: 'scheduled'
};

function folderOf(row: ResultRow, kind: SearchMatch['kind']): string {
	if (kind !== 'message') return kind === 'draft' ? 'drafts' : 'scheduled';
	const f = row.flags;
	if (f & Flag.trash) return 'trash';
	if (f & Flag.spam) return 'spam';
	if (f & Flag.snoozed) return 'snoozed';
	if (row.folders[0]) return customFolderRoute(row.folders[0]);
	if (f & Flag.archive) return 'archive';
	return folderFromServer('inbox', f & Flag.sent ? 'sent' : 'received');
}

export function messageFromRow(row: ResultRow): Message {
	const kind = KIND_NAME[row.best.kind] ?? 'message';
	const person = kind === 'message' ? row.from : (row.to[0] ?? row.from);
	const address = person?.address ?? '';
	const display = person?.name || address || m.mailbox_unknown_sender();
	const palette = paletteFor(address.toLowerCase());
	const known = (bit: number) => (row.knownFlags & bit) !== 0;
	const passage = row.channel && row.channel !== 'words' ? (row.passage ?? null) : null;
	return {
		id: row.best.sourceId,
		folder: folderOf(row, kind),
		folderId: row.folders[0] ?? null,
		direction: row.flags & Flag.sent ? 'sent' : 'received',
		from: display,
		fromAddr: address,
		to: row.to.map((p) => p.name || p.address).join(', '),
		recipients: [],
		init: initialsFor(display, address),
		bg: palette.bg,
		fg: palette.fg,
		epoch: row.date,
		subj: row.subject || m.mail_compose_no_subject(),
		labels: row.labels,
		unread: kind === 'message' && known(Flag.read) && (row.flags & Flag.read) === 0,
		starred: kind === 'message' && (row.flags & Flag.starred) !== 0,
		snoozedUntil: null,
		prev: passage?.text ?? row.excerpt?.text ?? '',
		body: [],
		threadRootId: row.threadId ?? undefined,
		attachments: row.attachments > 0 ? new Array(row.attachments).fill({ name: row.filename ?? '', size: '' }) : undefined,
		match: passage
			? {
					kind,
					matches: row.matches,
					subjectSpans: [],
					excerpt: passage.text,
					excerptSpans: [],
					clippedStart: false,
					clippedEnd: false,
					fields: [passage.field],
					quoted: passage.field === Field.quoted,
					filename: passage.attachmentId && passage.attachmentId === row.excerpt?.attachmentId ? row.filename : null,
					place: passage.place,
					channel: row.channel ?? null
				}
			: {
					kind,
					matches: row.matches,
					subjectSpans: row.subject ? row.subjectSpans : [],
					excerpt: row.excerpt?.text ?? null,
					excerptSpans: row.excerpt?.spans ?? [],
					clippedStart: row.excerpt?.clippedStart ?? false,
					clippedEnd: row.excerpt?.clippedEnd ?? false,
					fields: row.fields,
					quoted: row.excerpt?.field === Field.quoted,
					filename: row.filename,
					place: row.excerpt?.place ?? null,
					channel: row.channel ?? null
				}
	};
}
