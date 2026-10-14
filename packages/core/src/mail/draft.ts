import { platform } from '$platform';
import { keystore } from '$core/keystore/keystore-client';
import { issueDraftAttachmentUpload } from '$core/api/drafts';
import { senderKey, buildEnvelope, encryptTo, sha256B64 } from './send';
import { decryptBodyFromUrl, DecryptionError } from './decrypt';
import { decryptAttachmentFull } from './attachments';
import { snippetSource } from './quote';
import * as attframe from './attframe';
import type { AttDisposition } from './attframe';
import type { MessagePreview } from './preview';
import type {
	DraftAttachmentsChange,
	DraftDetail,
	DraftRequest,
	PresignedPointer
} from '$core/api/types';

export const DRAFT_SCHEMA_VERSION = 1;
export const DRAFT_DOC_VERSION = 2;

export interface DraftRecipient {
	name?: string;
	address: string;
}

export interface DraftAttachmentMeta {
	filename: string;
	mime: string;
	size: number;
	disposition: AttDisposition;
	contentId?: string;
	offset: number;
	length: number;
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

export interface DraftAttachmentSource {
	file: File;
	disposition: AttDisposition;
	contentId?: string;
}

export interface PackedDraftBundle {
	ciphertext: Uint8Array;
	sha256B64: string;
	fingerprintB64: string;
	metas: DraftAttachmentMeta[];
}

export interface RestoredDraftAttachment {
	file: File;
	disposition: AttDisposition;
	contentId?: string;
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

export async function buildDraftEnvelope(
	accountId: string,
	doc: DraftDoc,
	attachments?: DraftAttachmentsChange
): Promise<DraftRequest> {
	const sender = await senderKey(accountId);
	const docBytes = new TextEncoder().encode(JSON.stringify(doc));
	const previewBytes = new TextEncoder().encode(JSON.stringify(draftPreview(doc)));
	const sealed = await buildEnvelope(accountId, previewBytes, docBytes, sender);
	const req: DraftRequest = { schemaVersion: DRAFT_SCHEMA_VERSION, sealed };
	if (attachments) req.attachments = attachments;
	return req;
}

export async function loadDraftDoc(accountId: string, detail: DraftDetail): Promise<DraftDoc> {
	const { plaintext } = await decryptBodyFromUrl(accountId, detail.body.url);
	const doc = JSON.parse(plaintext) as DraftDoc;
	if (doc.v !== DRAFT_DOC_VERSION || !Array.isArray(doc.attachments)) doc.attachments = [];
	return doc;
}

export async function packDraftBundle(
	accountId: string,
	sources: DraftAttachmentSource[]
): Promise<PackedDraftBundle> {
	const frames: Uint8Array[] = [];
	const metas: DraftAttachmentMeta[] = [];
	let offset = 0;
	for (const s of sources) {
		const bytes = new Uint8Array(await s.file.arrayBuffer());
		const mime = s.file.type || 'application/octet-stream';
		const frame = attframe.build(
			{
				filename: s.file.name || 'attachment',
				contentType: mime,
				disposition: s.disposition,
				contentId: s.contentId,
				plaintextSha256: await sha256B64(bytes)
			},
			bytes
		);
		frames.push(frame);
		metas.push({
			filename: s.file.name || 'attachment',
			mime,
			size: s.file.size,
			disposition: s.disposition,
			contentId: s.contentId,
			offset,
			length: frame.byteLength
		});
		offset += frame.byteLength;
	}
	const plaintext = new Uint8Array(offset);
	let at = 0;
	for (const f of frames) {
		plaintext.set(f, at);
		at += f.byteLength;
	}
	const sender = await senderKey(accountId);
	const ciphertext = await encryptTo(accountId, plaintext, sender.publicKeyArmored);
	return {
		ciphertext,
		sha256B64: await sha256B64(ciphertext),
		fingerprintB64: sender.fingerprintB64,
		metas
	};
}

export async function uploadDraftBundle(draftId: string, packed: PackedDraftBundle): Promise<string> {
	const grant = await issueDraftAttachmentUpload(draftId, {
		ciphertextSizeBytes: packed.ciphertext.byteLength,
		ciphertextSha256: packed.sha256B64,
		keyFingerprint: packed.fingerprintB64
	});
	const resp = await platform.blobPut(grant.putUrl, new Blob([packed.ciphertext as BlobPart]));
	if (!resp.ok) throw new Error(`PUT ${resp.status}`);
	return grant.uploadId;
}

export async function restoreDraftAttachments(
	accountId: string,
	doc: DraftDoc,
	pointer: PresignedPointer
): Promise<RestoredDraftAttachment[]> {
	const resp = await platform.blobFetch(pointer.url);
	if (!resp.ok) throw new DecryptionError('unknown', `fetch attachments ${resp.status}`);
	const ciphertext = new Uint8Array(await resp.arrayBuffer());
	if (pointer.sha256 && (await sha256B64(ciphertext)) !== pointer.sha256) {
		throw new DecryptionError('invalid_ciphertext', 'attachments checksum mismatch');
	}
	const res = await keystore.decrypt({ accountId, ciphertextBinary: ciphertext, binary: true });
	if (!res.ok) throw new DecryptionError(res.code);
	if (!('plaintextBinary' in res)) {
		throw new DecryptionError('invalid_ciphertext', 'expected binary attachments');
	}
	return unpackDraftBundle(res.plaintextBinary, doc.attachments);
}

export function unpackDraftBundle(
	plaintext: Uint8Array,
	metas: DraftAttachmentMeta[]
): RestoredDraftAttachment[] {
	return metas.map((meta) => {
		if (meta.offset < 0 || meta.offset + meta.length > plaintext.byteLength) {
			throw new DecryptionError('invalid_ciphertext', 'attachment outside bundle');
		}
		const { header, payload } = attframe.parse(plaintext.subarray(meta.offset, meta.offset + meta.length));
		return {
			file: new File([payload as BlobPart], header.filename || meta.filename || 'attachment', {
				type: header.contentType || meta.mime || 'application/octet-stream'
			}),
			disposition: header.disposition,
			contentId: header.contentId ?? undefined
		};
	});
}

export async function restoreAttachmentFile(
	accountId: string,
	pointer: PresignedPointer
): Promise<File> {
	const dec = await decryptAttachmentFull(accountId, pointer);
	return new File([dec.blob], dec.header.filename || 'attachment', {
		type: dec.header.contentType || 'application/octet-stream'
	});
}
