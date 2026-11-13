export const SourceKind = {
	message: 1,
	draft: 2,
	scheduled: 3
} as const;
export type SourceKind = (typeof SourceKind)[keyof typeof SourceKind];

export const Field = {
	subject: 1,
	participant: 2,
	body: 3,
	quoted: 4,
	attachmentName: 5,
	attachmentText: 6,
	identifier: 7
} as const;
export type Field = (typeof Field)[keyof typeof Field];

export const Role = {
	from: 1,
	to: 2,
	cc: 3,
	bcc: 4,
	replyTo: 5,
	sender: 6
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const Flag = {
	read: 1 << 0,
	starred: 1 << 1,
	inbox: 1 << 2,
	archive: 1 << 3,
	sent: 1 << 4,
	spam: 1 << 5,
	trash: 1 << 6,
	snoozed: 1 << 7,
	attachments: 1 << 8
} as const;

export const Dimension = {
	metadata: 1,
	body: 2,
	attachmentMetadata: 3,
	attachmentText: 4,
	ocr: 5,
	semantic: 6
} as const;
export type Dimension = (typeof Dimension)[keyof typeof Dimension];

export const Coverage = {
	pending: 0,
	processing: 1,
	complete: 2,
	unsupported: 3,
	locked: 4,
	failed: 5,
	resourceLimited: 6,
	excludedByUser: 7,
	deleted: 8
} as const;
export type Coverage = (typeof Coverage)[keyof typeof Coverage];

export type CollectionType = 'folder' | 'label';

export interface Participant {
	role: Role;
	name: string;
	address: string;
}

export interface Collection {
	id: string;
	type: CollectionType;
}

export interface Attachment {
	attachmentId: string;
	filename: string;
	mime: string;
	size: number;
}

export interface Part {
	field: Field;
	text: string;
	attachmentId?: string;
	locator?: number;
}

export interface SourceMetadata {
	metadataRevision: number;
	threadId: string | null;
	date: number;
	flags: number;
	knownFlags: number;
	collections: Collection[];
}

export interface SearchDocument extends SourceMetadata {
	kind: SourceKind;
	sourceId: string;
	contentRevision: number;
	size: number;
	messageId: string | null;
	subject: string | null;
	participants: Participant[];
	attachments: Attachment[];
	parts: Part[];
	coverage: Partial<Record<Dimension, Coverage>>;
}

export interface SourceKey {
	kind: SourceKind;
	sourceId: string;
}

export type PutResult = 'inserted' | 'replaced' | 'metadata' | 'unchanged' | 'stale';
