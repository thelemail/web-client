import { parseMimeBody, ParseError, type ParsedAttachment, type InlineImage } from './parseMime';
import { sanitizeHtml } from './sanitizeHtml';
import { plainToHtml } from './plainToHtml';
import { splitQuotedHtml, splitQuotedText } from './quoteSplit';
import type { CalendarEvent } from './icalParse';

export interface RenderInput {
	mime?: string;
	html?: string;
	text?: string;
	stripTracking?: boolean;
}

export interface RenderResult {
	srcDoc: string;
	attachments: ParsedAttachment[];
	calendarEvents: CalendarEvent[];
	contentHtml?: string;
	contentText?: string;
	quoted?: { srcDoc: string };
	forwarded?: boolean;
}

const BASE_STYLE = [
	'html,body{margin:0;padding:0;background:transparent}',
	'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;color:#222;word-wrap:break-word}',
	'.plain{padding:2px;max-width:68ch}',
	'.plain p{margin:0 0 16px}',
	'img{max-width:100%;height:auto}',
	'a{color:#234132}',
	'blockquote{margin:0 0 16px;padding-left:14px;border-left:2px solid #DCD4BE;color:#515845}',
	'pre{white-space:pre-wrap;word-wrap:break-word;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}',
	':root[data-theme="dark"]{color-scheme:dark}',
	':root[data-theme="dark"] body{color:#DDE0D2}',
	':root[data-theme="dark"] a{color:#9EC4AC}',
	':root[data-theme="dark"] blockquote{border-left-color:#3E4A3C;color:#A9B09D}'
].join('');

const CSP =
	"default-src 'none'; " +
	"style-src 'unsafe-inline'; " +
	"img-src data: cid:; " +
	'font-src data:; ' +
	"connect-src 'none'; " +
	"script-src 'none'; " +
	"object-src 'none'; " +
	"form-action 'none'";

function escapeForAttribute(s: string): string {
	return s.replace(/[&<>"']/g, (c) =>
		c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
	);
}

export function buildSrcDoc(bodyHtml: string, wrapPlain: boolean): string {
	const content = wrapPlain ? `<div class="plain">${bodyHtml}</div>` : bodyHtml;
	return (
		'<!doctype html><html><head><meta charset="utf-8">' +
		`<meta http-equiv="Content-Security-Policy" content="${escapeForAttribute(CSP)}">` +
		'<base target="_blank">' +
		`<style>${BASE_STYLE}</style></head><body>${content}</body></html>`
	);
}

export async function renderBody(input: RenderInput): Promise<RenderResult> {
	let html: string | undefined;
	let text: string | undefined;
	let inlineImages: Record<string, InlineImage> = {};
	let attachments: ParsedAttachment[] = [];
	let calendarEvents: CalendarEvent[] = [];

	if (input.mime && input.mime.trim().length > 0) {
		try {
			const parsed = await parseMimeBody(input.mime);
			html = parsed.html;
			text = parsed.text;
			inlineImages = parsed.inlineImages;
			attachments = parsed.attachments;
			calendarEvents = parsed.calendarEvents;
		} catch (e) {
			if (!(e instanceof ParseError)) throw e;
			text = input.mime;
		}
	} else {
		html = input.html;
		text = input.text;
	}

	const hasHtml = typeof html === 'string' && html.trim().length > 0;
	const hasText = typeof text === 'string' && text.trim().length > 0;

	let body: string;
	let wrapPlain = false;
	let quotedSrcDoc: string | undefined;
	let forwarded = false;
	let contentHtml: string | undefined;

	if (hasHtml) {
		const sanitized = sanitizeHtml(html!, {
			inlineImages,
			stripTracking: input.stripTracking
		});
		contentHtml = sanitized;
		const split = splitQuotedHtml(sanitized);
		body = split.mainHtml;
		if (split.kind === 'quoted' && split.quotedHtml) {
			quotedSrcDoc = buildSrcDoc(split.quotedHtml, false);
		}
		if (split.kind === 'forwarded') forwarded = true;
	} else if (hasText) {
		const split = splitQuotedText(text!);
		if (split.kind === 'quoted' && split.quotedHtml) {
			body = plainToHtml(split.mainHtml);
			quotedSrcDoc = buildSrcDoc(plainToHtml(split.quotedHtml), true);
			wrapPlain = true;
		} else {
			body = plainToHtml(text!);
			wrapPlain = true;
			if (split.kind === 'forwarded') forwarded = true;
		}
	} else {
		body = '<p style="color:#9a9a90;font-style:italic">(no body)</p>';
	}

	const srcDoc = buildSrcDoc(body, wrapPlain);
	const result: RenderResult = {
		srcDoc,
		attachments,
		calendarEvents
	};
	if (contentHtml) result.contentHtml = contentHtml;
	if (hasText) result.contentText = text;
	if (quotedSrcDoc) result.quoted = { srcDoc: quotedSrcDoc };
	if (forwarded) result.forwarded = true;
	return result;
}
