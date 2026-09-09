import { formatClock, formatDateLong, formatWeekday } from './data';
import { strippedSubject } from './subjects';

export interface QuoteSource {
	fromDisplay: string;
	fromAddress: string;
	toLine: string;
	ccLine?: string;
	epoch: number;
	subject: string;
	html?: string;
	text?: string;
}

const FORWARD_MARKER = '---------- Forwarded message ---------';

const BLOCKQUOTE_STYLE = 'margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex';

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function partyLabel(src: QuoteSource): string {
	if (src.fromDisplay && src.fromAddress) return `${src.fromDisplay} <${src.fromAddress}>`;
	if (src.fromAddress) return `<${src.fromAddress}>`;
	return src.fromDisplay;
}

function attributionDate(epoch: number): string {
	const d = new Date(epoch);
	return `${formatWeekday(d)}, ${formatDateLong(d)} at ${formatClock(d)}`;
}

function sourceHtml(src: QuoteSource): string {
	if (src.html) return src.html;
	return escapeHtml(src.text ?? '').replace(/\r?\n/g, '<br>');
}

function sourceText(src: QuoteSource): string {
	return src.text ?? '';
}

export function replyAttribution(src: QuoteSource): string {
	return `On ${attributionDate(src.epoch)}, ${partyLabel(src)} wrote:`;
}

export function replyQuoteHtml(src: QuoteSource): string {
	return `<div class="gmail_quote"><div class="gmail_attr">${escapeHtml(replyAttribution(src))}</div><blockquote class="gmail_quote" style="${BLOCKQUOTE_STYLE}">${sourceHtml(src)}</blockquote></div>`;
}

export function replyQuoteText(src: QuoteSource): string {
	const quoted = sourceText(src)
		.split(/\r?\n/)
		.map((l) => `> ${l}`)
		.join('\n');
	return `${replyAttribution(src)}\n${quoted}`;
}

function forwardHeaderLines(src: QuoteSource): string[] {
	const lines = [
		FORWARD_MARKER,
		`From: ${partyLabel(src)}`,
		`Date: ${attributionDate(src.epoch)}`,
		`Subject: ${strippedSubject(src.subject)}`,
		`To: ${src.toLine}`
	];
	if (src.ccLine) lines.push(`Cc: ${src.ccLine}`);
	return lines;
}

export function forwardQuoteText(src: QuoteSource): string {
	return [...forwardHeaderLines(src), '', sourceText(src)].join('\n');
}

export function forwardQuoteHtml(src: QuoteSource): string {
	const head = forwardHeaderLines(src)
		.map((l) => escapeHtml(l))
		.join('<br>');
	return `<div class="gmail_quote"><div class="gmail_attr">${head}</div><br>${sourceHtml(src)}</div>`;
}

const FORWARD_HEADER_FIELD = /^(from|date|sent|subject|to|cc|bcc|reply-to):/i;

export function snippetSource(body: string): string {
	const lines = body.split(/\r?\n/);
	const marker = lines.findIndex((l) => l.trim() === FORWARD_MARKER);
	if (marker === -1) return body.trim();
	const note = lines.slice(0, marker).join('\n').trim();
	if (note) return note;
	let i = marker + 1;
	while (i < lines.length && FORWARD_HEADER_FIELD.test(lines[i])) i++;
	while (i < lines.length && !lines[i].trim()) i++;
	return lines.slice(i).join('\n').trim();
}
