import { keystore } from '$lib/keystore/keystore-client';
import { aliasKeys } from '$lib/stores/aliasKeys.svelte';
import { parse as parseAttFrame, type DecryptedAttachmentHeader } from './attframe';
import type { AttachmentDetail } from '$lib/api/types';

export type AttachmentDecryptError =
	| 'locked'
	| 'invalid_ciphertext'
	| 'network'
	| 'unsupported_version'
	| 'unknown';

export interface DecryptedAttachment {
	header: DecryptedAttachmentHeader;
	bytes: Uint8Array;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
	const resp = await fetch(url);
	if (!resp.ok) {
		throw new Error(`fetch ${resp.status}: ${resp.statusText}`);
	}
	return new Uint8Array(await resp.arrayBuffer());
}

export async function decryptAttachmentFull(
	accountId: string,
	pointer: { url: string }
): Promise<DecryptedAttachment> {
	const cipher = await fetchBytes(pointer.url);
	await aliasKeys.ready(accountId);
	const res = await keystore.decrypt({ accountId, ciphertextBinary: cipher, binary: true });
	if (!('ok' in res) || !res.ok) {
		throw new Error(`decrypt failed: ${'code' in res ? res.code : 'unknown'}`);
	}
	if (!('plaintextBinary' in res)) {
		throw new Error('decrypt returned non-binary');
	}
	const { header, payload } = parseAttFrame(res.plaintextBinary);
	return { header, bytes: payload };
}

export async function decryptAttachmentHeader(
	accountId: string,
	pointer: { url: string }
): Promise<DecryptedAttachmentHeader> {
	const full = await decryptAttachmentFull(accountId, pointer);
	return full.header;
}

export async function downloadAttachment(
	accountId: string,
	pointer: { url: string },
	known?: DecryptedAttachmentHeader
): Promise<void> {
	let dec: DecryptedAttachment;
	if (known) {
		dec = await decryptAttachmentFull(accountId, pointer);
	} else {
		dec = await decryptAttachmentFull(accountId, pointer);
	}
	const ab = dec.bytes.buffer.slice(
		dec.bytes.byteOffset,
		dec.bytes.byteOffset + dec.bytes.byteLength
	) as ArrayBuffer;
	const blob = new Blob([ab], { type: dec.header.contentType || 'application/octet-stream' });
	const url = URL.createObjectURL(blob);
	try {
		const a = document.createElement('a');
		a.href = url;
		a.download = dec.header.filename || 'attachment';
		document.body.appendChild(a);
		a.click();
		a.remove();
	} finally {
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
	}
}

export type AttachmentChip = {
	id: string;
	ordinal: number;
	pointer: AttachmentDetail['pointer'];
	state: 'loading' | 'ready' | 'error';
	header?: DecryptedAttachmentHeader;
	error?: string;
};

export function initialChips(atts: AttachmentDetail[]): AttachmentChip[] {
	return atts
		.filter((a) => !a.isInline)
		.map((a) => ({
			id: a.id,
			ordinal: a.ordinal,
			pointer: a.pointer,
			state: 'loading'
		}));
}
