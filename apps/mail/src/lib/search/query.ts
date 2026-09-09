import type { IndexedRow, IndexedText } from './types';

const WEIGHT_SUBJECT = 10;
const WEIGHT_SENDER = 6;
const WEIGHT_RECIPIENTS = 3;
const WEIGHT_SNIPPET = 2;
const MAX_TERMS = 16;
const EXCERPT_RADIUS = 60;

export function normalize(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
}

export function parseTerms(input: string): string[] {
	return normalize(input)
		.split(/[^\p{L}\p{N}@._+-]+/u)
		.filter((t) => t.length > 0)
		.slice(0, MAX_TERMS);
}

export type SearchFolder =
	| 'inbox'
	| 'sent'
	| 'archive'
	| 'spam'
	| 'trash'
	| 'snoozed'
	| 'starred';

const FOLDERS: readonly SearchFolder[] = [
	'inbox',
	'sent',
	'archive',
	'spam',
	'trash',
	'snoozed',
	'starred'
];

export interface ParsedQuery {
	terms: string[];
	from: string[];
	folder: SearchFolder | null;
	unknownFolder: string | null;
	unread: boolean | null;
	starred: boolean;
	hasAttachment: boolean;
}

export function splitRespectingQuotes(input: string): string[] {
	const out: string[] = [];
	let current = '';
	let quoted = false;
	for (const ch of input) {
		if (ch === '"') {
			quoted = !quoted;
			continue;
		}
		if (!quoted && /\s/u.test(ch)) {
			if (current) out.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	if (current) out.push(current);
	return out;
}

function isFolder(value: string): value is SearchFolder {
	return (FOLDERS as readonly string[]).includes(value);
}

export function parseQuery(input: string): ParsedQuery {
	const parsed: ParsedQuery = {
		terms: [],
		from: [],
		folder: null,
		unknownFolder: null,
		unread: null,
		starred: false,
		hasAttachment: false
	};
	const free: string[] = [];

	for (const token of splitRespectingQuotes(input)) {
		const at = token.indexOf(':');
		const key = at < 0 ? '' : token.slice(0, at).toLowerCase();
		const raw = at < 0 ? '' : token.slice(at + 1);
		const value = raw.toLowerCase();
		if (key === 'from' && value) {
			parsed.from.push(normalize(raw));
		} else if (key === 'in' && value) {
			if (isFolder(value)) {
				parsed.folder = value;
				parsed.unknownFolder = null;
			} else {
				parsed.folder = null;
				parsed.unknownFolder = value;
			}
		} else if (key === 'is' && value === 'unread') {
			parsed.unread = true;
		} else if (key === 'is' && value === 'read') {
			parsed.unread = false;
		} else if (key === 'is' && value === 'starred') {
			parsed.starred = true;
		} else if (key === 'has' && value === 'attachment') {
			parsed.hasAttachment = true;
		} else {
			free.push(token);
		}
	}

	parsed.terms = parseTerms(free.join(' '));
	return parsed;
}

export function hasFilters(parsed: ParsedQuery): boolean {
	return (
		parsed.from.length > 0 ||
		parsed.folder !== null ||
		parsed.unknownFolder !== null ||
		parsed.unread !== null ||
		parsed.starred ||
		parsed.hasAttachment
	);
}

export function isEmptyQuery(parsed: ParsedQuery): boolean {
	return parsed.terms.length === 0 && !hasFilters(parsed);
}

function folderOf(row: IndexedRow): SearchFolder {
	if (row.mailboxState === 'archive') return 'archive';
	if (row.mailboxState === 'trash') return 'trash';
	if (row.mailboxState === 'spam') return 'spam';
	if (row.mailboxState === 'snoozed') return 'snoozed';
	return row.direction === 'sent' ? 'sent' : 'inbox';
}

export function matchesRow(row: IndexedRow, parsed: ParsedQuery): boolean {
	if (parsed.unknownFolder !== null) return false;
	if (parsed.folder === 'starred') {
		if (!row.starred) return false;
	} else if (parsed.folder !== null && folderOf(row) !== parsed.folder) {
		return false;
	}
	if (parsed.unread !== null && row.read !== !parsed.unread) return false;
	if (parsed.starred && !row.starred) return false;
	if (parsed.hasAttachment && row.attachmentCount <= 0) return false;
	return true;
}

export function matchesFrom(text: IndexedText, parsed: ParsedQuery): boolean {
	if (!parsed.from.length) return true;
	const sender = normalize(`${text.senderDisplay} ${text.senderAddress}`);
	return parsed.from.every((needle) => sender.includes(needle));
}

interface Haystack {
	subject: string;
	sender: string;
	recipients: string;
	snippet: string;
}

function haystackFor(text: IndexedText): Haystack {
	return {
		subject: normalize(text.subject),
		sender: normalize(`${text.senderDisplay} ${text.senderAddress}`),
		recipients: normalize(text.recipients),
		snippet: normalize(text.snippet)
	};
}

function fieldScore(field: string, term: string): number {
	if (!field) return 0;
	const at = field.indexOf(term);
	if (at < 0) return 0;
	const before = at === 0 ? '' : field[at - 1];
	return before === '' || !/[\p{L}\p{N}]/u.test(before) ? 1 : 0.5;
}

export function scoreText(text: IndexedText, terms: string[]): number {
	if (!terms.length) return 0;
	const hay = haystackFor(text);
	let total = 0;
	for (const term of terms) {
		const subject = fieldScore(hay.subject, term) * WEIGHT_SUBJECT;
		const sender = fieldScore(hay.sender, term) * WEIGHT_SENDER;
		const recipients = fieldScore(hay.recipients, term) * WEIGHT_RECIPIENTS;
		const snippet = fieldScore(hay.snippet, term) * WEIGHT_SNIPPET;
		const best = Math.max(subject, sender, recipients, snippet);
		if (best === 0) return 0;
		total += best;
	}
	return total;
}

export function excerptFor(text: IndexedText, terms: string[]): string {
	const source = text.snippet || text.subject;
	if (!source || !terms.length) return text.snippet;
	const normalized = normalize(source);
	let at = -1;
	for (const term of terms) {
		const found = normalized.indexOf(term);
		if (found >= 0 && (at < 0 || found < at)) at = found;
	}
	if (at < 0) return text.snippet;
	const start = Math.max(0, at - EXCERPT_RADIUS);
	const end = Math.min(source.length, at + EXCERPT_RADIUS);
	const head = start > 0 ? '…' : '';
	const tail = end < source.length ? '…' : '';
	return `${head}${source.slice(start, end).trim()}${tail}`;
}
