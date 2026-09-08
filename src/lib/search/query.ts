import type { IndexedText } from './types';

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
