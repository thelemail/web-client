import { keystore } from '$core/keystore/keystore-client';
import { bytesToB64, b64ToBytes, b64ToHex } from '$core/keys/encode';
import * as attframe from '$core/mail/attframe';
import type { SignatureRecord, UpsertSignatureInput } from '$core/api/signatures';

export type SignatureMode = 'rich' | 'html' | 'markdown';

export interface SignatureDocImage {
	objectKey: string;
	contentType: string;
}

export interface SignatureDoc {
	v: 1;
	mode: SignatureMode;
	source: string;
	bodyHtml: string;
	images: SignatureDocImage[];
}

export type OpenedSignature =
	| { ok: true; doc: SignatureDoc; legacy: boolean }
	| { ok: false; reason: 'locked' | 'unreadable' };

export function emptyDoc(): SignatureDoc {
	return { v: 1, mode: 'rich', source: '', bodyHtml: '', images: [] };
}

export function legacyDoc(bodyHtml: string): SignatureDoc {
	return { v: 1, mode: 'rich', source: bodyHtml, bodyHtml, images: [] };
}

function normalize(raw: unknown, fallbackHtml: string): SignatureDoc {
	if (!raw || typeof raw !== 'object') return legacyDoc(fallbackHtml);
	const d = raw as Partial<SignatureDoc>;
	const mode: SignatureMode =
		d.mode === 'html' || d.mode === 'markdown' || d.mode === 'rich' ? d.mode : 'rich';
	const bodyHtml = typeof d.bodyHtml === 'string' ? d.bodyHtml : '';
	return {
		v: 1,
		mode,
		source: typeof d.source === 'string' ? d.source : bodyHtml,
		bodyHtml,
		images: Array.isArray(d.images)
			? d.images.filter(
					(i): i is SignatureDocImage =>
						!!i && typeof i.objectKey === 'string' && typeof i.contentType === 'string'
				)
			: []
	};
}

export async function openSignature(
	accountId: string,
	record: SignatureRecord
): Promise<OpenedSignature> {
	if (!record.sealedBody) {
		return { ok: true, doc: legacyDoc(record.bodyHtml ?? ''), legacy: true };
	}
	const res = await keystore.decrypt({
		accountId,
		ciphertextBinary: b64ToBytes(record.sealedBody),
		keyFingerprintHex: record.bodyKeyFingerprint ? b64ToHex(record.bodyKeyFingerprint) : undefined
	});
	if (!res.ok) {
		return { ok: false, reason: res.code === 'locked' ? 'locked' : 'unreadable' };
	}
	const text = 'plaintext' in res ? res.plaintext : new TextDecoder().decode(res.plaintextBinary);
	try {
		return { ok: true, doc: normalize(JSON.parse(text), ''), legacy: false };
	} catch {
		return { ok: false, reason: 'unreadable' };
	}
}

export interface SealTarget {
	accountId: string;
	aliasId?: string;
}

async function targetKey(target: SealTarget): Promise<{ armored: string; fingerprintB64: string }> {
	const r = await keystore.getPublicKey({
		accountId: target.accountId,
		aliasId: target.aliasId
	});
	if (!r.ok) throw new Error('locked');
	return { armored: r.publicKeyArmored, fingerprintB64: bytesToB64(r.fingerprint) };
}

async function sealBytes(target: SealTarget, plaintext: Uint8Array) {
	const key = await targetKey(target);
	const res = await keystore.encrypt({
		accountId: target.accountId,
		recipientPublicKeyArmored: key.armored,
		plaintext
	});
	if (!res.ok) throw new Error(`signature: encrypt failed (${res.code})`);
	return { ciphertext: res.ciphertext, fingerprintB64: key.fingerprintB64 };
}

export async function sealSignature(
	target: SealTarget,
	doc: SignatureDoc,
	flags: { enabled: boolean; appendOnReply: boolean }
): Promise<UpsertSignatureInput> {
	const plaintext = new TextEncoder().encode(JSON.stringify(doc));
	const { ciphertext, fingerprintB64 } = await sealBytes(target, plaintext);
	return {
		sealedBody: bytesToB64(ciphertext),
		bodyKeyFingerprint: fingerprintB64,
		enabled: flags.enabled,
		appendOnReply: flags.appendOnReply
	};
}

export interface SealedImage {
	ciphertext: Uint8Array;
	ciphertextSha256: string;
	keyFingerprint: string;
}

export async function sealSignatureImage(
	target: SealTarget,
	bytes: Uint8Array,
	meta: { filename: string; contentType: string }
): Promise<SealedImage> {
	const framed = attframe.build(
		{ filename: meta.filename, contentType: meta.contentType, disposition: 'inline' },
		bytes
	);
	const { ciphertext, fingerprintB64 } = await sealBytes(target, framed);
	const digest = await crypto.subtle.digest('SHA-256', ciphertext as BufferSource);
	return {
		ciphertext,
		ciphertextSha256: bytesToB64(new Uint8Array(digest)),
		keyFingerprint: fingerprintB64
	};
}

export interface OpenedImage {
	bytes: Uint8Array;
	contentType: string;
}

export async function openSignatureImage(
	accountId: string,
	ciphertext: Uint8Array
): Promise<OpenedImage> {
	const res = await keystore.decrypt({ accountId, ciphertextBinary: ciphertext, binary: true });
	if (!res.ok) throw new Error(`signature image: decrypt failed (${res.code})`);
	const plain =
		'plaintextBinary' in res ? res.plaintextBinary : new TextEncoder().encode(res.plaintext);
	const parsed = attframe.parse(plain);
	return { bytes: parsed.payload, contentType: parsed.header.contentType };
}
