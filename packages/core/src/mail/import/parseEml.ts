import { enableIconvFallback, mayNeedIconv } from '../render/textDecoderPolyfill';
import PostalMime, { type Address, type Attachment } from 'postal-mime';

export interface ParsedEmlAddress {
	display: string;
	address: string;
}

export interface ParsedEmlRecipient extends ParsedEmlAddress {
	kind: 'to' | 'cc';
}

export interface ParsedEmlAttachment {
	filename: string;
	mimeType: string;
	disposition: 'attachment' | 'inline';
	contentId?: string;
	bytes: Uint8Array;
}

export interface ParsedEml {
	messageId?: string;
	inReplyTo?: string;
	references: string[];
	date?: Date;
	subject: string;
	from: ParsedEmlAddress;
	recipients: ParsedEmlRecipient[];
	text?: string;
	html?: string;
	attachments: ParsedEmlAttachment[];
	remoteImageUrls: string[];
}

export class EmlParseError extends Error {
	cause?: unknown;
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = 'EmlParseError';
		this.cause = cause;
	}
}

function sniffNeedsIconv(head: string): boolean {
	const re = /charset\s*=\s*"?([A-Za-z0-9_\-:.]+)"?/gi;
	for (const m of head.matchAll(re)) {
		if (mayNeedIconv(m[1])) return true;
	}
	return false;
}

function attachmentBytes(content: Attachment['content']): Uint8Array {
	if (content instanceof Uint8Array) return content;
	if (content instanceof ArrayBuffer) return new Uint8Array(content);
	return new TextEncoder().encode(String(content));
}

function flattenAddresses(list: Address[] | undefined): ParsedEmlAddress[] {
	const out: ParsedEmlAddress[] = [];
	for (const a of list ?? []) {
		if (a.group) {
			out.push(...flattenAddresses(a.group));
		} else if (a.address) {
			out.push({ display: a.name ?? '', address: a.address });
		}
	}
	return out;
}

function stripCidBrackets(cid: string): string {
	return cid.replace(/^<|>$/g, '');
}

function splitReferences(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw.split(/\s+/).filter(Boolean);
}

function extractRemoteImageUrls(html: string | undefined): string[] {
	if (!html) return [];
	const urls = new Set<string>();
	const re = /<img\b[^>]*?\bsrc\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi;
	for (const m of html.matchAll(re)) {
		urls.add(m[1]);
	}
	return [...urls];
}

export async function parseEml(raw: Uint8Array): Promise<ParsedEml> {
	const head = new TextDecoder('latin1').decode(raw.subarray(0, 8192));
	if (sniffNeedsIconv(head)) {
		try {
			await enableIconvFallback();
		} catch {
		}
	}

	let email;
	try {
		email = await PostalMime.parse(raw);
	} catch (e) {
		throw new EmlParseError('Failed to parse .eml', e);
	}

	const from = flattenAddresses(email.from ? [email.from] : undefined)[0] ?? {
		display: '',
		address: ''
	};
	const recipients: ParsedEmlRecipient[] = [
		...flattenAddresses(email.to).map((a) => ({ ...a, kind: 'to' as const })),
		...flattenAddresses(email.cc).map((a) => ({ ...a, kind: 'cc' as const }))
	];

	const attachments: ParsedEmlAttachment[] = [];
	let ordinal = 0;
	for (const a of email.attachments ?? []) {
		const bytes = attachmentBytes(a.content);
		if (bytes.byteLength === 0) continue;
		const inline = a.related === true || a.disposition === 'inline';
		const contentId = a.contentId ? stripCidBrackets(a.contentId) : undefined;
		const filename = a.filename || (inline && contentId ? contentId : `attachment-${ordinal}`);
		attachments.push({
			filename,
			mimeType: a.mimeType || 'application/octet-stream',
			disposition: inline ? 'inline' : 'attachment',
			contentId,
			bytes
		});
		ordinal++;
	}

	let date: Date | undefined;
	if (email.date) {
		const d = new Date(email.date);
		if (!Number.isNaN(d.getTime())) date = d;
	}

	return {
		messageId: email.messageId || undefined,
		inReplyTo: email.inReplyTo || undefined,
		references: splitReferences(email.references),
		date,
		subject: email.subject || '',
		from,
		recipients,
		text: email.text || undefined,
		html: email.html || undefined,
		attachments,
		remoteImageUrls: extractRemoteImageUrls(email.html || undefined)
	};
}
