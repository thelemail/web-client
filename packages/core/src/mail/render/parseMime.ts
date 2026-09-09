import { enableIconvFallback, mayNeedIconv } from './textDecoderPolyfill';
import PostalMime, { type Attachment } from 'postal-mime';
import { parseIcs, type CalendarEvent } from './icalParse';

function sniffNeedsIconv(raw: string): boolean {
	const head = raw.slice(0, 8192);
	const re = /charset\s*=\s*"?([A-Za-z0-9_\-:.]+)"?/gi;
	for (const m of head.matchAll(re)) {
		if (mayNeedIconv(m[1])) return true;
	}
	return false;
}

export interface InlineImage {
	mimeType: string;
	data: Uint8Array;
}

export interface ParsedAttachment {
	filename: string;
	mimeType: string;
	size: number;
}

export interface ParsedMime {
	html?: string;
	text?: string;
	inlineImages: Record<string, InlineImage>;
	attachments: ParsedAttachment[];
	calendarEvents: CalendarEvent[];
	subject?: string;
}

export class ParseError extends Error {
	cause?: unknown;
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = 'ParseError';
		this.cause = cause;
	}
}

function stripCidBrackets(cid: string): string {
	return cid.replace(/^<|>$/g, '');
}

function attachmentBytes(content: Attachment['content']): Uint8Array {
	if (content instanceof Uint8Array) return content;
	if (content instanceof ArrayBuffer) return new Uint8Array(content);
	return new TextEncoder().encode(String(content));
}

export async function parseMimeBody(raw: string): Promise<ParsedMime> {
	if (sniffNeedsIconv(raw)) {
		try {
			await enableIconvFallback();
		} catch {
		}
	}

	let email;
	try {
		email = await PostalMime.parse(raw);
	} catch (e) {
		throw new ParseError('Failed to parse MIME body', e);
	}

	const inlineImages: Record<string, InlineImage> = {};
	const attachments: ParsedAttachment[] = [];
	const calendarEvents: CalendarEvent[] = [];

	for (const a of email.attachments ?? []) {
		const bytes = attachmentBytes(a.content);
		const lowerMime = (a.mimeType || '').toLowerCase();
		if (lowerMime === 'text/calendar' || lowerMime === 'application/ics') {
			try {
				const text = new TextDecoder('utf-8').decode(bytes);
				const events = parseIcs(text);
				const methodHint = a.method as string | undefined;
				for (const ev of events) {
					if (!ev.method && methodHint) ev.method = methodHint.toUpperCase();
				}
				calendarEvents.push(...events);
			} catch {
			}
			continue;
		}
		if (a.related && a.contentId) {
			inlineImages[stripCidBrackets(a.contentId)] = {
				mimeType: a.mimeType,
				data: bytes
			};
		} else if (a.filename) {
			attachments.push({
				filename: a.filename,
				mimeType: a.mimeType,
				size: bytes.byteLength
			});
		}
	}

	return {
		html: email.html || undefined,
		text: email.text || undefined,
		inlineImages,
		attachments,
		calendarEvents,
		subject: email.subject
	};
}
