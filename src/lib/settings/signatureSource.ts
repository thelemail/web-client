import { marked } from 'marked';
import TurndownService from 'turndown';
import { sanitizeSignatureHtml } from '$lib/mail/render/sanitizeSignature';
import type { SignatureMode } from '$lib/mail/signatureCrypto';

const HTML_HINT = /<\/?(?:p|div|br|span|a|img|table|tr|td|ul|ol|li|strong|em|b|i|u|h[1-6])\b[^>]*>/i;
const MD_HINT = [
	/^\s{0,3}#{1,6}\s+\S/m,
	/\[[^\]]+\]\([^)]+\)/,
	/!\[[^\]]*\]\([^)]+\)/,
	/^\s{0,3}[-*+]\s+\S/m,
	/^\s{0,3}\d+\.\s+\S/m,
	/\*\*[^*\s][^*]*\*\*/,
	/^\s{0,3}>\s+\S/m,
	/^\s{0,3}```/m,
	/^\s{0,3}\|.+\|\s*$/m
];

export type SourceKind = 'html' | 'markdown' | 'plain';

export function detectSourceKind(text: string): SourceKind {
	const t = (text ?? '').trim();
	if (!t) return 'plain';
	if (HTML_HINT.test(t)) return 'html';
	if (MD_HINT.some((re) => re.test(t))) return 'markdown';
	return 'plain';
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export function plainToHtml(text: string): string {
	const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
	if (paragraphs.length === 0) return '';
	return paragraphs
		.map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
		.join('');
}

export function markdownToHtml(source: string): string {
	return marked.parse(source, { async: false, gfm: true, breaks: true }) as string;
}

export function renderSource(mode: SignatureMode, source: string): string {
	if (!source.trim()) return '';
	const raw =
		mode === 'markdown' ? markdownToHtml(source) : mode === 'html' ? source : plainToHtml(source);
	return sanitizeSignatureHtml(raw, { keepRemoteImages: true });
}

let turndown: TurndownService | null = null;

export function htmlToMarkdown(html: string): string {
	turndown ??= new TurndownService({
		headingStyle: 'atx',
		bulletListMarker: '-',
		codeBlockStyle: 'fenced',
		emDelimiter: '*'
	});
	return turndown.turndown(html ?? '');
}
