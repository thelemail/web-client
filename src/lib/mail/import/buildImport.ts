import { keystore } from '$lib/keystore/keystore-client';
import { bytesToB64 } from '$lib/crypto';
import { senderKey, buildMIME, SendError, type KeyMaterial } from '../send';
import { build as buildAttFrame } from '../attframe';
import { issueAttachmentUploadUrls, importMessage } from '$lib/api/messages';
import type {
	AttachmentUploadSlotRequest,
	ClientInboundImportRequest,
	ClientInboundImportResponse,
	ImportAttachmentDescriptor
} from '$lib/api/types';
import type { MessagePreview, MessagePreviewRecipient } from '../preview';
import { parseEml, type ParsedEml, type ParsedEmlAttachment } from './parseEml';
import { buildInlinedBody, resolveBimiDomain } from './inlineImages';

export const MAX_IMPORT_EML_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_ATTACHMENTS = 100;
const SNIPPET_LIMIT = 280;

export class ImportTooLargeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImportTooLargeError';
	}
}

export class ImportTooManyAttachmentsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImportTooManyAttachmentsError';
	}
}

async function sha256B64(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return bytesToB64(new Uint8Array(digest));
}

function collapseWhitespace(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

function stripHtml(s: string): string {
	return collapseWhitespace(s.replace(/<[^>]*>/g, ' '));
}

function buildSnippet(p: ParsedEml): string {
	const base = p.text ? collapseWhitespace(p.text) : p.html ? stripHtml(p.html) : '';
	return base.slice(0, SNIPPET_LIMIT);
}

function buildPreview(p: ParsedEml, bimiDomain: string): MessagePreview {
	const recipients: MessagePreviewRecipient[] = p.recipients.map((r) => ({
		display: r.display,
		address: r.address,
		kind: r.kind
	}));
	const flags: MessagePreview['flags'] = { imported: true };
	if (bimiDomain) flags.bimi_domain = bimiDomain;
	return {
		v: 1,
		subject: p.subject,
		sender: { display: p.from.display, address: p.from.address },
		recipients,
		snippet: buildSnippet(p),
		display_date: (p.date ?? new Date()).toISOString(),
		flags
	};
}

async function uploadBody(key: KeyMaterial, cipher: Uint8Array, sha: string): Promise<string> {
	const slotId = crypto.randomUUID();
	const slots: AttachmentUploadSlotRequest[] = [
		{
			slotId,
			role: 'sender',
			ordinal: 0,
			ciphertextSizeBytes: cipher.length,
			ciphertextSha256: sha,
			keyFingerprint: key.fingerprintB64
		}
	];
	const grants = await issueAttachmentUploadUrls({ slots });
	const grant = grants.slots.find((g) => g.slotId === slotId);
	if (!grant) throw new Error('missing body upload grant');
	await putCiphertext(grant.putUrl, cipher);
	return grant.objectKey;
}

async function encryptToSelf(
	accountId: string,
	key: KeyMaterial,
	plaintext: Uint8Array
): Promise<Uint8Array> {
	const r = await keystore.encrypt({
		accountId,
		recipientPublicKeyArmored: key.publicKeyArmored,
		plaintext
	});
	if (!r.ok) throw new SendError(r.code === 'locked' ? 'locked' : 'encrypt', `keystore.encrypt: ${r.code}`);
	return r.ciphertext;
}

function putCiphertext(url: string, cipher: Uint8Array): Promise<void> {
	const ab = cipher.buffer.slice(
		cipher.byteOffset,
		cipher.byteOffset + cipher.byteLength
	) as ArrayBuffer;
	return fetch(url, { method: 'PUT', body: new Blob([ab]) }).then((res) => {
		if (!res.ok) throw new Error(`attachment PUT ${res.status}`);
	});
}

async function uploadAttachments(
	accountId: string,
	key: KeyMaterial,
	atts: ParsedEmlAttachment[]
): Promise<ImportAttachmentDescriptor[]> {
	if (atts.length === 0) return [];

	const prepared: {
		ordinal: number;
		cipher: Uint8Array;
		sha: string;
		isInline: boolean;
		contentIdHash?: string;
	}[] = [];
	for (let i = 0; i < atts.length; i++) {
		const a = atts[i];
		const framed = buildAttFrame(
			{
				filename: a.filename,
				contentType: a.mimeType,
				disposition: a.disposition,
				contentId: a.contentId,
				plaintextSha256: await sha256B64(a.bytes)
			},
			a.bytes
		);
		const cipher = await encryptToSelf(accountId, key, framed);
		prepared.push({
			ordinal: i,
			cipher,
			sha: await sha256B64(cipher),
			isInline: a.disposition === 'inline',
			contentIdHash: a.contentId
				? await sha256B64(new TextEncoder().encode(a.contentId))
				: undefined
		});
	}

	const slots: AttachmentUploadSlotRequest[] = prepared.map((p) => ({
		slotId: crypto.randomUUID(),
		role: 'sender',
		ordinal: p.ordinal,
		ciphertextSizeBytes: p.cipher.length,
		ciphertextSha256: p.sha,
		keyFingerprint: key.fingerprintB64
	}));
	const grants = await issueAttachmentUploadUrls({ slots });
	const grantBySlot = new Map(grants.slots.map((g) => [g.slotId, g]));

	const out: ImportAttachmentDescriptor[] = [];
	for (let i = 0; i < prepared.length; i++) {
		const p = prepared[i];
		const grant = grantBySlot.get(slots[i].slotId);
		if (!grant) throw new Error('missing upload grant');
		await putCiphertext(grant.putUrl, p.cipher);
		out.push({
			ordinal: p.ordinal,
			objectKey: grant.objectKey,
			ciphertextSizeBytes: p.cipher.length,
			ciphertextSha256: p.sha,
			keyFingerprint: key.fingerprintB64,
			isInline: p.isInline,
			contentIdHash: p.contentIdHash
		});
	}
	return out;
}

export async function importEmlFile(
	accountId: string,
	raw: Uint8Array
): Promise<ClientInboundImportResponse> {
	if (raw.byteLength > MAX_IMPORT_EML_BYTES) {
		throw new ImportTooLargeError(
			`file is ${(raw.byteLength / 1048576).toFixed(1)} MB; max ${MAX_IMPORT_EML_BYTES / 1048576} MB`
		);
	}
	const parsed = await parseEml(raw);
	const regularAtts = parsed.attachments.filter(
		(a) => !(a.disposition === 'inline' && a.contentId)
	);
	if (regularAtts.length > MAX_IMPORT_ATTACHMENTS) {
		throw new ImportTooManyAttachmentsError(
			`message has ${regularAtts.length} attachments; max ${MAX_IMPORT_ATTACHMENTS}`
		);
	}

	const key = await senderKey(accountId);
	const contentHash = await sha256B64(raw);

	const inlined = await buildInlinedBody(parsed);
	const partiesOf = (kind: 'to' | 'cc') =>
		parsed.recipients
			.filter((r) => r.kind === kind)
			.map((r) => ({ display: r.display, address: r.address }));
	const ccParties = partiesOf('cc');
	const bodyMime = buildMIME({
		fromName: parsed.from.display,
		fromAddress: parsed.from.address || 'unknown@import.local',
		to: partiesOf('to'),
		cc: ccParties.length ? ccParties : undefined,
		subject: parsed.subject,
		body: inlined.text ?? '',
		bodyHtml: inlined.html,
		date: parsed.date ?? new Date(),
		messageId: crypto.randomUUID(),
		relatedParts: inlined.related
	});

	const senderDomain = (parsed.from.address.split('@')[1] ?? '').trim();
	const bimiDomain = senderDomain ? await resolveBimiDomain(senderDomain) : '';

	const preview = buildPreview(parsed, bimiDomain);
	const previewBytes = new TextEncoder().encode(JSON.stringify(preview));

	const [previewCipher, bodyCipher] = await Promise.all([
		encryptToSelf(accountId, key, previewBytes),
		encryptToSelf(accountId, key, bodyMime)
	]);
	const bodySha = await sha256B64(bodyCipher);
	const bodyObjectKey = await uploadBody(key, bodyCipher, bodySha);
	const attachments = await uploadAttachments(accountId, key, regularAtts);

	const req: ClientInboundImportRequest = {
		schemaVersion: 1,
		storedAt: (parsed.date ?? new Date()).toISOString(),
		externalMessageId: parsed.messageId,
		contentHash,
		inReplyToHeader: parsed.inReplyTo,
		references: parsed.references.length ? parsed.references : undefined,
		sent: {
			encryptedPreview: bytesToB64(previewCipher),
			previewKeyFingerprint: key.fingerprintB64,
			bodyObjectKey,
			bodyKeyFingerprint: key.fingerprintB64,
			bodySha256: bodySha,
			bodySizeBytes: bodyCipher.length
		},
		attachments
	};

	return importMessage(req);
}
