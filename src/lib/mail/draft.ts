import { senderKey, buildEnvelope } from './send';
import { decryptBodyFromUrl } from './decrypt';
import { decryptAttachmentFull } from './attachments';
import { snippetSource } from './quote';
import type { MessagePreview } from './preview';
import type { AttachmentDescriptor, DraftDetail, DraftRequest } from '$lib/api/types';

export const DRAFT_SCHEMA_VERSION = 1;

export interface DraftRecipient {
	name?: string;
	address: string;
}

export interface DraftAttachmentMeta {
	ordinal: number;
	objectKey: string;
	ciphertextSizeBytes: number;
	ciphertextSha256: string;
	keyFingerprint: string;
	filename: string;
	mime: string;
	size: number;
	disposition: 'attachment' | 'inline';
	contentId?: string;
}

export interface DraftDoc {
	v: number;
	from: { email: string; name: string };
	to: DraftRecipient[];
	cc: DraftRecipient[];
	bcc: DraftRecipient[];
	subject: string;
	bodyHtml: string;
	bodyText: string;
	inReplyToMessageId?: string;
	inReplyToHeader?: string;
	references?: string[];
	attachments: DraftAttachmentMeta[];
}

function draftPreview(doc: DraftDoc): MessagePreview {
	const recipients = [
		...doc.to.map((r) => ({ display: r.name ?? '', address: r.address, kind: 'to' as const })),
		...doc.cc.map((r) => ({ display: r.name ?? '', address: r.address, kind: 'cc' as const })),
		...doc.bcc.map((r) => ({ display: r.name ?? '', address: r.address, kind: 'bcc' as const }))
	];
	return {
		v: 1,
		subject: doc.subject,
		sender: { display: doc.from.name, address: doc.from.email },
		recipients,
		snippet: snippetSource(doc.bodyText).slice(0, 280),
		display_date: new Date().toISOString(),
		flags: {}
	};
}

export async function buildDraftEnvelope(accountId: string, doc: DraftDoc): Promise<DraftRequest> {
	const sender = await senderKey(accountId);
	const docBytes = new TextEncoder().encode(JSON.stringify(doc));
	const previewBytes = new TextEncoder().encode(JSON.stringify(draftPreview(doc)));
	const attachments: AttachmentDescriptor[] = doc.attachments.map((a) => ({
		ordinal: a.ordinal,
		objectKey: a.objectKey,
		ciphertextSizeBytes: a.ciphertextSizeBytes,
		ciphertextSha256: a.ciphertextSha256,
		keyFingerprint: a.keyFingerprint
	}));
	const sealed = await buildEnvelope(accountId, previewBytes, docBytes, sender, attachments);
	return { schemaVersion: DRAFT_SCHEMA_VERSION, sealed };
}

export async function loadDraftDoc(accountId: string, detail: DraftDetail): Promise<DraftDoc> {
	const json = await decryptBodyFromUrl(accountId, detail.body.url);
	return JSON.parse(json) as DraftDoc;
}

export async function restoreAttachmentFile(
	accountId: string,
	pointer: { url: string }
): Promise<File> {
	const dec = await decryptAttachmentFull(accountId, pointer);
	const ab = dec.bytes.buffer.slice(
		dec.bytes.byteOffset,
		dec.bytes.byteOffset + dec.bytes.byteLength
	) as ArrayBuffer;
	return new File([ab], dec.header.filename || 'attachment', {
		type: dec.header.contentType || 'application/octet-stream'
	});
}
