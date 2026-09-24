import type { ReplyParty } from './replyRecipients';
import type { Attachment as ComposeAttachment } from './attachmentUpload';

export type MimeSource = Blob | Uint8Array;

export interface RelatedMIMEPart {
	contentId: string;
	contentType: string;
	bytes: Uint8Array;
}

export interface MIMEAttachment {
	filename: string;
	contentType: string;
	source: MimeSource;
	disposition?: 'attachment' | 'inline';
	contentId?: string;
}

export interface BuildMIMEArgs {
	fromName: string;
	fromAddress: string;
	to: ReplyParty[];
	cc?: ReplyParty[];
	bcc?: ReplyParty[];
	replyTo?: ReplyParty;
	subject: string;
	body: string;
	bodyHtml?: string;
	date: Date;
	messageId: string;
	messageIdDomain?: string;
	inReplyTo?: string;
	references?: string[];
	calendar?: { method: 'REQUEST' | 'REPLY' | 'CANCEL'; ics: string };
	relatedParts?: RelatedMIMEPart[];
	attachments?: MIMEAttachment[];
}

export interface IssuedHeaders {
	date: string;
	messageId: string;
	fromName: string;
	fromAddress: string;
	inReplyTo?: string;
	references?: string[];
	replyTo?: string;
}

type Chunk = string | { base64: MimeSource };

const BASE64_LINE_BYTES = 57;
export const BASE64_WINDOW = BASE64_LINE_BYTES * 12288;
const QP_LINE_LIMIT = 76;
const HEADER_LINE_LIMIT = 78;
const HEADER_TOKEN_LIMIT = 60;
const ENCODED_WORD_BYTES = 45;
const PREAMBLE = 'This is a multipart message in MIME format.\r\n\r\n';

export function readMimeAttachments(attachments: ComposeAttachment[]): MIMEAttachment[] {
	return attachments.map((a) => ({
		filename: a.file.name,
		contentType: a.file.type || 'application/octet-stream',
		source: a.file,
		disposition: a.disposition,
		contentId: a.contentId
	}));
}

export function messageIdDomain(fromAddress: string): string {
	const clean = escapeAddress(fromAddress);
	const at = clean.lastIndexOf('@');
	const domain = at >= 0 ? clean.slice(at + 1) : '';
	return domain || 'thelemail.local';
}

function isBytes(s: MimeSource): s is Uint8Array {
	return ArrayBuffer.isView(s);
}

function sourceSize(s: MimeSource): number {
	return isBytes(s) ? s.length : s.size;
}

function headerChunks(args: BuildMIMEArgs, issued?: IssuedHeaders): string[] {
	const domain = escapeAddress(args.messageIdDomain ?? '') || 'thelemail.local';
	const from = issued
		? exactMailbox(issued.fromName, issued.fromAddress)
		: mailbox(args.fromName, args.fromAddress);
	const headers: string[] = [foldHeader('From', from)];
	if (args.to.length) headers.push(foldHeader('To', formatParties(args.to)));
	if (args.cc && args.cc.length) headers.push(foldHeader('Cc', formatParties(args.cc)));
	if (!issued && args.bcc && args.bcc.length) headers.push(foldHeader('Bcc', formatParties(args.bcc)));
	if (issued) {
		if (issued.replyTo) headers.push(`Reply-To: ${escapeAddress(issued.replyTo)}`);
	} else if (args.replyTo) {
		headers.push(foldHeader('Reply-To', formatParty(args.replyTo)));
	}
	headers.push(
		foldHeader('Subject', encodeHeaderText(args.subject) || '(no subject)'),
		`Date: ${headerValue(issued ? issued.date : args.date.toUTCString())}`,
		`Message-ID: ${issued ? headerValue(issued.messageId) : ensureAngled(`${args.messageId}@${domain}`)}`,
		'MIME-Version: 1.0'
	);
	const inReplyTo = issued ? headerValue(issued.inReplyTo ?? '') : args.inReplyTo ? ensureAngled(args.inReplyTo) : '';
	if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
	const references = issued
		? (issued.references ?? []).map(headerValue)
		: (args.references ?? []).map((r) => ensureAngled(r));
	const refs = references.filter((r) => r.length > 0);
	if (refs.length) headers.push(foldHeader('References', refs.join(' ')));
	return headers;
}

function messageChunks(args: BuildMIMEArgs, issued?: IssuedHeaders): Chunk[] {
	const content = contentEntity(args);
	const headers = [...headerChunks(args, issued), ...content.headerLines];
	return [headers.join('\r\n') + '\r\n\r\n', ...content.body];
}

function bodyEntityChunks(args: BuildMIMEArgs): Chunk[] {
	const content = contentEntity(args);
	return [content.headerLines.join('\r\n') + '\r\n\r\n', ...content.body];
}

function contentEntity(args: BuildMIMEArgs): { headerLines: string[]; body: Chunk[] } {
	const text = normalizeCRLF(args.body || '');
	const html = args.bodyHtml ? normalizeCRLF(args.bodyHtml) : undefined;
	const related = (args.relatedParts ?? []).filter((p) => p.bytes && p.bytes.length > 0);
	const attachments = (args.attachments ?? []).filter((a) => sourceSize(a.source) > 0);

	if (attachments.length > 0 || args.calendar) {
		const parts: Chunk[][] = [bodyAlternative(text, html, related)];
		for (const att of attachments) parts.push(attachmentPart(att));
		if (args.calendar) parts.push(calendarPart(args.calendar));
		const boundary = makeBoundary('mix');
		return {
			headerLines: [`Content-Type: multipart/mixed; boundary="${boundary}"`],
			body: [PREAMBLE, ...multipart(boundary, parts), '\r\n']
		};
	}
	if (html) {
		const boundary = makeBoundary('alt');
		const parts = [textPart(text), related.length > 0 ? htmlRelated(html, related) : htmlPart(html)];
		return {
			headerLines: [`Content-Type: multipart/alternative; boundary="${boundary}"`],
			body: [PREAMBLE, ...multipart(boundary, parts), '\r\n']
		};
	}
	return {
		headerLines: ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable'],
		body: [quotedPrintable(text)]
	};
}

function multipart(boundary: string, parts: Chunk[][]): Chunk[] {
	const out: Chunk[] = [];
	for (const p of parts) {
		out.push(`--${boundary}\r\n`, ...p, '\r\n');
	}
	out.push(`--${boundary}--`);
	return out;
}

function nested(contentType: string, boundary: string, parts: Chunk[][]): Chunk[] {
	return [`Content-Type: ${contentType}; boundary="${boundary}"\r\n\r\n`, ...multipart(boundary, parts)];
}

function bodyAlternative(text: string, html?: string, related: RelatedMIMEPart[] = []): Chunk[] {
	if (!html) return textPart(text);
	const parts = [textPart(text), related.length > 0 ? htmlRelated(html, related) : htmlPart(html)];
	return nested('multipart/alternative', makeBoundary('alt'), parts);
}

function textPart(text: string): Chunk[] {
	return [
		'Content-Type: text/plain; charset=utf-8\r\n' +
			'Content-Transfer-Encoding: quoted-printable\r\n\r\n' +
			quotedPrintable(text)
	];
}

function htmlPart(html: string): Chunk[] {
	return [
		'Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n',
		{ base64: new TextEncoder().encode(html) }
	];
}

function htmlRelated(html: string, parts: RelatedMIMEPart[]): Chunk[] {
	return nested('multipart/related; type="text/html"', makeBoundary('rel'), [
		htmlPart(html),
		...parts.map(inlineImagePart)
	]);
}

function inlineImagePart(part: RelatedMIMEPart): Chunk[] {
	return [
		`Content-Type: ${escapeContentType(part.contentType)}\r\n` +
			'Content-Transfer-Encoding: base64\r\n' +
			`Content-ID: ${ensureAngled(part.contentId)}\r\n` +
			'Content-Disposition: inline\r\n\r\n',
		{ base64: part.bytes }
	];
}

function attachmentPart(att: MIMEAttachment): Chunk[] {
	const name = headerParam(att.filename) || 'attachment';
	const disposition = att.disposition === 'inline' ? 'inline' : 'attachment';
	const angledCid = att.contentId ? ensureAngled(att.contentId) : '';
	const cid = angledCid ? `Content-ID: ${angledCid}\r\n` : '';
	return [
		foldHeader('Content-Type', `${escapeContentType(att.contentType)}; name="${name}"`) +
			'\r\nContent-Transfer-Encoding: base64\r\n' +
			cid +
			foldHeader('Content-Disposition', `${disposition}; filename="${name}"`) +
			'\r\n\r\n',
		{ base64: att.source }
	];
}

function calendarPart(cal: { method: string; ics: string }): Chunk[] {
	const method = cal.method.toUpperCase().replace(/[^A-Z]/g, '') || 'REQUEST';
	return [
		`Content-Type: text/calendar; method=${method}; charset=utf-8\r\n` +
			'Content-Transfer-Encoding: base64\r\n' +
			'Content-Disposition: attachment; filename="invite.ics"\r\n\r\n',
		{ base64: new TextEncoder().encode(normalizeCRLF(cal.ics)) }
	];
}

function makeBoundary(tag: string): string {
	return `=_tm_${tag}_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function base64Lines(bytes: Uint8Array): string {
	let bin = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	const b64 = btoa(bin);
	const lines: string[] = [];
	for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
	return lines.join('\r\n');
}

async function* encodeSource(source: MimeSource): AsyncGenerator<string> {
	if (isBytes(source)) {
		for (let off = 0; off < source.length; off += BASE64_WINDOW) {
			yield (off > 0 ? '\r\n' : '') + base64Lines(source.subarray(off, off + BASE64_WINDOW));
		}
		return;
	}
	for (let off = 0; off < source.size; off += BASE64_WINDOW) {
		const window = new Uint8Array(await source.slice(off, off + BASE64_WINDOW).arrayBuffer());
		yield (off > 0 ? '\r\n' : '') + base64Lines(window);
		window.fill(0);
	}
}

function syncJoin(chunks: Chunk[]): string {
	let out = '';
	for (const c of chunks) {
		if (typeof c === 'string') {
			out += c;
			continue;
		}
		if (!isBytes(c.base64)) {
			throw new Error('buildMIME needs in-memory attachment bytes; use composeMime for files');
		}
		for (let off = 0; off < c.base64.length; off += BASE64_WINDOW) {
			out += (off > 0 ? '\r\n' : '') + base64Lines(c.base64.subarray(off, off + BASE64_WINDOW));
		}
	}
	return out;
}

async function blobParts(chunks: Chunk[]): Promise<string[]> {
	const out: string[] = [];
	for (const c of chunks) {
		if (typeof c === 'string') {
			out.push(c);
			continue;
		}
		for await (const piece of encodeSource(c.base64)) out.push(piece);
	}
	return out;
}

export function buildMIME(args: BuildMIMEArgs): Uint8Array {
	return new TextEncoder().encode(syncJoin(messageChunks(args)));
}

export function buildBodyEntity(args: BuildMIMEArgs): Uint8Array {
	return new TextEncoder().encode(syncJoin(bodyEntityChunks(args)));
}

export async function composeMime(args: BuildMIMEArgs, issued?: IssuedHeaders): Promise<Blob> {
	const parts = await blobParts(messageChunks({ ...args, bcc: issued ? undefined : args.bcc }, issued));
	return new Blob(parts, { type: 'message/rfc822' });
}

export async function composeMimeBytes(args: BuildMIMEArgs): Promise<Uint8Array> {
	return joinBytes(await blobParts(messageChunks(args)));
}

export async function composeBodyEntityBytes(args: BuildMIMEArgs): Promise<Uint8Array> {
	return joinBytes(await blobParts(bodyEntityChunks(args)));
}

function joinBytes(parts: string[]): Uint8Array {
	const encoder = new TextEncoder();
	const encoded = parts.map((p) => encoder.encode(p));
	const out = new Uint8Array(encoded.reduce((n, p) => n + p.length, 0));
	let off = 0;
	for (const p of encoded) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

export function quotedPrintable(text: string): string {
	const encoder = new TextEncoder();
	const out: string[] = [];
	for (const line of text.split('\r\n')) {
		const bytes = encoder.encode(line);
		let current = '';
		for (let i = 0; i < bytes.length; i++) {
			const b = bytes[i];
			const last = i === bytes.length - 1;
			let token: string;
			if ((b >= 33 && b <= 126 && b !== 61) || ((b === 32 || b === 9) && !last)) {
				token = String.fromCharCode(b);
			} else {
				token = '=' + b.toString(16).toUpperCase().padStart(2, '0');
			}
			if (current.length + token.length > QP_LINE_LIMIT - 1) {
				out.push(current + '=');
				current = '';
			}
			current += token;
		}
		out.push(current);
	}
	return out.join('\r\n');
}

function formatParty(p: ReplyParty): string {
	return mailbox(p.display, p.address);
}

function formatParties(parties: ReplyParty[]): string {
	return parties.map(formatParty).join(', ');
}

function ensureAngled(id: string): string {
	const s = headerValue(id).replace(/[<>\s]/g, '');
	return s ? `<${s}>` : '';
}

export function normalizeCRLF(s: string): string {
	return s.replace(/\r\n|\r|\n/g, '\r\n');
}

function headerValue(s: string): string {
	// eslint-disable-next-line no-control-regex
	return s.replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]/g, '');
}

function isPlainHeaderText(s: string): boolean {
	for (const ch of s) {
		const c = ch.codePointAt(0)!;
		if (c < 0x20 || c > 0x7e) return false;
	}
	return !s.split(' ').some((token) => token.length > HEADER_TOKEN_LIMIT);
}

function encodedWord(bytes: number[]): string {
	return `=?utf-8?B?${btoa(String.fromCharCode(...bytes))}?=`;
}

export function encodeHeaderText(s: string): string {
	const value = headerValue(s);
	if (isPlainHeaderText(value)) return value;
	return encodeWords(value);
}

function encodeWords(value: string): string {
	const encoder = new TextEncoder();
	const words: string[] = [];
	let chunk: number[] = [];
	for (const ch of value) {
		const bytes = encoder.encode(ch);
		if (chunk.length > 0 && chunk.length + bytes.length > ENCODED_WORD_BYTES) {
			words.push(encodedWord(chunk));
			chunk = [];
		}
		for (const b of bytes) chunk.push(b);
	}
	if (chunk.length > 0) words.push(encodedWord(chunk));
	return words.join(' ');
}

export function foldHeader(name: string, value: string): string {
	if (!value) return `${name}:`;
	const lines: string[] = [];
	let line = `${name}:`;
	let empty = true;
	for (const word of value.split(' ')) {
		if (!empty && line.length + 1 + word.length > HEADER_LINE_LIMIT) {
			lines.push(line);
			line = ` ${word}`;
		} else {
			line += ` ${word}`;
			empty = false;
		}
	}
	lines.push(line);
	return lines.join('\r\n');
}

function headerText(s: string): string {
	return headerValue(s).replace(/"/g, '').slice(0, 200);
}

function quotedText(s: string): string {
	return s.replace(/\\/g, '\\\\');
}

function mailbox(display: string, address: string): string {
	const addr = escapeAddress(address);
	const name = headerText(display);
	if (!name) return addr;
	return isPlainHeaderText(name)
		? `"${quotedText(name)}" <${addr}>`
		: `${encodeHeaderText(name)} <${addr}>`;
}

function exactMailbox(display: string, address: string): string {
	const addr = escapeAddress(address);
	const name = headerValue(display);
	if (!name) return addr;
	if (isPlainHeaderText(name) && !/["\\]/.test(name) && name.trim() === name) {
		return `"${name}" <${addr}>`;
	}
	return `${encodeWords(name)} <${addr}>`;
}

function headerParam(s: string): string {
	const value = headerText(s);
	return isPlainHeaderText(value) ? quotedText(value) : encodeHeaderText(value);
}

function escapeAddress(s: string): string {
	return headerValue(s)
		.replace(/[<>,;:"\\()[\]\s]/g, '')
		.slice(0, 320);
}

function escapeContentType(s: string): string {
	const t = headerValue(s)
		.replace(/[;"\\()<>,:[\]?=\s]/g, '')
		.slice(0, 200);
	return t || 'application/octet-stream';
}
