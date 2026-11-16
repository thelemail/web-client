import type { SearchMessageDescriptor, SearchSourceDescriptor } from '../../api/types';
import { Coverage, Dimension, Field, Flag, Role, SourceKind, type Collection, type Participant, type SearchDocument, type SourceMetadata } from '../sqlite/types';

export const SIZE_VERSION = 1;

export const MESSAGE_FLAGS = Flag.read | Flag.starred | Flag.inbox | Flag.archive | Flag.sent | Flag.spam | Flag.trash | Flag.snoozed;

export interface Preview {
	subject: string;
	snippet: string;
	participants: Participant[];
	date: number | null;
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function party(role: Role, value: unknown): Participant | null {
	if (!value || typeof value !== 'object') return null;
	const v = value as Record<string, unknown>;
	const address = text(v.address).trim();
	if (!address) return null;
	return { role, name: text(v.display ?? v.name), address };
}

const RECIPIENT_ROLE: Record<string, Role> = { to: Role.to, cc: Role.cc, bcc: Role.bcc };

export function parsePreview(json: string): Preview | null {
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(json) as Record<string, unknown>;
	} catch {
		return null;
	}
	if (!raw || typeof raw !== 'object') return null;
	const participants: Participant[] = [];
	const sender = party(Role.from, raw.sender);
	if (sender) participants.push(sender);
	if (Array.isArray(raw.recipients)) {
		for (const r of raw.recipients) {
			const role = RECIPIENT_ROLE[text((r as Record<string, unknown>)?.kind)] ?? Role.to;
			const p = party(role, r);
			if (p) participants.push(p);
		}
	}
	if (Array.isArray(raw.reply_to)) {
		for (const r of raw.reply_to) {
			const p = party(Role.replyTo, r);
			if (p) participants.push(p);
		}
	}
	const delivered = text(raw.delivered_to).trim();
	if (delivered) participants.push({ role: Role.deliveredTo, name: '', address: delivered });
	const date = Date.parse(text(raw.display_date));
	return { subject: text(raw.subject), snippet: text(raw.snippet), participants, date: Number.isFinite(date) ? date : null };
}

function time(value: string | undefined): number | null {
	if (!value) return null;
	const t = Date.parse(value);
	return Number.isFinite(t) ? t : null;
}

export function messageFlags(m: SearchMessageDescriptor): number {
	let flags = 0;
	if (m.read) flags |= Flag.read;
	if (m.starred) flags |= Flag.starred;
	if (m.direction === 'sent') flags |= Flag.sent;
	switch (m.mailboxState) {
		case 'inbox':
			flags |= Flag.inbox;
			break;
		case 'archive':
			flags |= Flag.archive;
			break;
		case 'spam':
			flags |= Flag.spam;
			break;
		case 'trash':
			flags |= Flag.trash;
			break;
		case 'snoozed':
			flags |= Flag.snoozed;
			break;
	}
	if (m.attachments.some((a) => !a.inline)) flags |= Flag.attachments;
	return flags;
}

function messageCollections(m: SearchMessageDescriptor): Collection[] {
	const out: Collection[] = [];
	if (m.folderId) out.push({ id: m.folderId, type: 'folder' });
	for (const id of m.labelIds) out.push({ id, type: 'label' });
	return out;
}

export function storedAtOf(d: SearchSourceDescriptor): number {
	return time(d.message?.storedAt) ?? time(d.scheduled?.scheduledAt) ?? 0;
}

export function metadataOf(d: SearchSourceDescriptor, preview: Preview | null): SourceMetadata {
	if (d.message) {
		return {
			metadataRevision: d.metadataRevision,
			threadId: d.message.threadRootId ?? d.sourceId,
			date: time(d.message.storedAt) ?? 0,
			flags: messageFlags(d.message),
			knownFlags: MESSAGE_FLAGS,
			collections: messageCollections(d.message)
		};
	}
	const date = d.scheduled ? time(d.scheduled.scheduledAt) : null;
	return {
		metadataRevision: d.metadataRevision,
		threadId: d.draft?.replyToMessageId ?? null,
		date: date ?? preview?.date ?? 0,
		flags: 0,
		knownFlags: MESSAGE_FLAGS,
		collections: []
	};
}

export interface PreviewOutcome {
	preview: Preview | null;
	metadata: Coverage;
}

export function previewDocument(kind: SourceKind, d: SearchSourceDescriptor, outcome: PreviewOutcome, body: Coverage): SearchDocument {
	const meta = metadataOf(d, outcome.preview);
	const p = outcome.preview;
	const attachments = d.message?.attachments ?? [];
	return {
		...meta,
		kind,
		sourceId: d.sourceId,
		sourceRevision: d.sourceRevision,
		contentRevision: d.contentRevision,
		extraction: 0,
		size: 0,
		sizeVersion: 0,
		messageId: null,
		subject: p?.subject || null,
		participants: p?.participants ?? [],
		attachments: [],
		parts: p?.snippet ? [{ field: Field.body, text: p.snippet }] : [],
		coverage: {
			[Dimension.metadata]: outcome.metadata,
			[Dimension.body]: body,
			...(attachments.length || d.message?.attachmentsInBody || d.draft?.attachmentsBundle ? { [Dimension.attachmentMetadata]: body === Coverage.unsupported ? body : Coverage.pending } : {})
		}
	};
}
