const MAGIC = new TextEncoder().encode('TMA1');
const VERSION = 0x01;
export const MAX_HEADER_BYTES = 64 * 1024;

export type AttDisposition = 'attachment' | 'inline';

export interface AttHeader {
	v: 1;
	filename: string;
	contentType: string;
	disposition: AttDisposition;
	contentId?: string;
	plaintextSize: number;
	plaintextSha256?: string;
}

export interface DecryptedAttachmentHeader {
	filename: string;
	contentType: string;
	disposition: AttDisposition;
	contentId: string | null;
	plaintextSize: number;
	plaintextSha256?: string;
}

export function build(header: Omit<AttHeader, 'v' | 'plaintextSize'>, payload: Uint8Array): Uint8Array {
	if (header.disposition !== 'attachment' && header.disposition !== 'inline') {
		throw new Error('attframe: disposition must be attachment|inline');
	}
	if (!header.filename) throw new Error('attframe: filename required');
	if (!header.contentType) throw new Error('attframe: contentType required');
	const full: AttHeader = { ...header, v: 1, plaintextSize: payload.byteLength };
	const headerJson = new TextEncoder().encode(JSON.stringify(full));
	if (headerJson.byteLength > MAX_HEADER_BYTES) {
		throw new Error(`attframe: header ${headerJson.byteLength} > ${MAX_HEADER_BYTES}`);
	}
	const out = new Uint8Array(4 + 1 + 4 + headerJson.byteLength + payload.byteLength);
	let off = 0;
	out.set(MAGIC, off);
	off += 4;
	out[off++] = VERSION;
	new DataView(out.buffer, out.byteOffset + off, 4).setUint32(0, headerJson.byteLength, false);
	off += 4;
	out.set(headerJson, off);
	off += headerJson.byteLength;
	out.set(payload, off);
	return out;
}

export interface ParseResult {
	header: DecryptedAttachmentHeader;
	payload: Uint8Array;
}

export function parse(b: Uint8Array): ParseResult {
	const { header, headerEnd } = parseHeaderInternal(b);
	const payload = b.subarray(headerEnd);
	if (payload.byteLength !== header.plaintextSize) {
		throw new Error(`attframe: payload size mismatch: header=${header.plaintextSize} got=${payload.byteLength}`);
	}
	return { header, payload };
}

export function parseHeader(b: Uint8Array): DecryptedAttachmentHeader {
	return parseHeaderInternal(b).header;
}

export function parseHeaderPrefix(
	b: Uint8Array
): { header: DecryptedAttachmentHeader; headerEnd: number } | null {
	for (let i = 0; i < 4 && i < b.byteLength; i++) {
		if (b[i] !== MAGIC[i]) throw new Error('attframe: bad magic');
	}
	if (b.byteLength >= 5 && b[4] !== VERSION) {
		throw new Error(`attframe: unsupported version ${b[4]}`);
	}
	if (b.byteLength < 9) return null;
	const hl = new DataView(b.buffer, b.byteOffset + 5, 4).getUint32(0, false);
	if (hl === 0 || hl > MAX_HEADER_BYTES) throw new Error(`attframe: bad header length ${hl}`);
	const headerEnd = 9 + hl;
	if (b.byteLength < headerEnd) return null;
	const json = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(9, headerEnd));
	const parsed = JSON.parse(json) as AttHeader;
	if (parsed.v !== 1) throw new Error(`attframe: unsupported version field ${parsed.v}`);
	if (parsed.disposition !== 'attachment' && parsed.disposition !== 'inline') {
		throw new Error('attframe: bad disposition');
	}
	return {
		header: {
			filename: String(parsed.filename ?? ''),
			contentType: String(parsed.contentType ?? 'application/octet-stream'),
			disposition: parsed.disposition,
			contentId: parsed.contentId ?? null,
			plaintextSize: Number(parsed.plaintextSize ?? 0),
			plaintextSha256: parsed.plaintextSha256
		},
		headerEnd
	};
}

function parseHeaderInternal(b: Uint8Array): { header: DecryptedAttachmentHeader; headerEnd: number } {
	const parsed = parseHeaderPrefix(b);
	if (!parsed) throw new Error('attframe: truncated header');
	return parsed;
}
