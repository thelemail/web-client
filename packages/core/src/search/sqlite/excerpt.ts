import type { Highlight } from './compile';
import { Field } from './types';

export interface Span {
	start: number;
	end: number;
}

export interface ExcerptPart {
	field: Field;
	text: string;
	attachmentId: string | null;
	locator: number | null;
}

export interface Excerpt {
	text: string;
	spans: Span[];
	field: Field | null;
	attachmentId: string | null;
	locator: number | null;
	clippedStart: boolean;
	clippedEnd: boolean;
}

export interface Highlighted {
	subject: Span[];
	excerpt: Excerpt | null;
	fields: Field[];
}

export const EXCERPT_CHARS = 180;
const LEAD_CHARS = 48;
const MAX_SPANS = 32;

const PREFERENCE: readonly Field[] = [Field.body, Field.attachmentText, Field.attachmentName, Field.quoted, Field.signature];

interface Folded {
	text: string;
	origin: number[];
}

function fold(text: string): Folded {
	let out = '';
	const origin: number[] = [];
	let i = 0;
	for (const ch of text) {
		const piece = ch.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
		for (let k = 0; k < piece.length; k++) origin.push(i);
		out += piece;
		i += ch.length;
	}
	origin.push(text.length);
	return { text: out, origin };
}

interface Word {
	start: number;
	end: number;
	token: string;
}

const WORD = /[\p{L}\p{N}]+/gu;

function words(f: Folded): Word[] {
	const out: Word[] = [];
	for (const m of f.text.matchAll(WORD)) {
		const start = m.index;
		out.push({ start: f.origin[start], end: f.origin[start + m[0].length], token: m[0] });
	}
	return out;
}

function tokensOf(text: string): string[] {
	return [...fold(text).text.matchAll(WORD)].map((m) => m[0]);
}

function find(text: string, highlights: readonly Highlight[], field: Field): Span[] {
	const relevant = highlights.filter((h) => h.fields.includes(field));
	if (!relevant.length || !text) return [];
	const folded = fold(text);
	const list = words(folded);
	const spans: Span[] = [];
	for (const h of relevant) {
		if (h.kind === 'literal') {
			const needle = fold(h.text).text;
			if (!needle) continue;
			for (let at = folded.text.indexOf(needle); at >= 0 && spans.length < MAX_SPANS; at = folded.text.indexOf(needle, at + needle.length)) {
				spans.push({ start: folded.origin[at], end: folded.origin[at + needle.length] });
			}
			continue;
		}
		const want = tokensOf(h.text);
		if (!want.length) continue;
		for (let i = 0; i + want.length <= list.length && spans.length < MAX_SPANS; i++) {
			const ok = want.every((t, j) => {
				const w = list[i + j].token;
				return h.kind === 'prefix' && j === want.length - 1 ? w.startsWith(t) : w === t;
			});
			if (ok) spans.push({ start: list[i].start, end: list[i + want.length - 1].end });
		}
	}
	return merge(spans);
}

function merge(spans: Span[]): Span[] {
	const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
	const out: Span[] = [];
	for (const s of sorted) {
		const last = out[out.length - 1];
		if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
		else out.push({ ...s });
	}
	return out;
}

function boundary(text: string, at: number, forward: boolean): number {
	if (at <= 0) return 0;
	if (at >= text.length) return text.length;
	const limit = 16;
	for (let k = 0; k < limit; k++) {
		const i = forward ? at + k : at - k;
		if (i <= 0 || i >= text.length) break;
		if (/\s/u.test(text[i])) return forward ? i : i + 1;
	}
	return at;
}

function clip(text: string, spans: Span[]): { text: string; spans: Span[]; clippedStart: boolean; clippedEnd: boolean } {
	const flat = text.replace(/\s+/gu, ' ');
	const shifted = shiftForWhitespace(text, spans);
	if (flat.length <= EXCERPT_CHARS) return { text: flat, spans: shifted, clippedStart: false, clippedEnd: false };
	const first = shifted[0]?.start ?? 0;
	let start = boundary(flat, Math.max(0, first - LEAD_CHARS), true);
	if (start > first) start = Math.max(0, first - LEAD_CHARS);
	let end = boundary(flat, Math.min(flat.length, start + EXCERPT_CHARS), false);
	if (end <= first) end = Math.min(flat.length, start + EXCERPT_CHARS);
	const inside = shifted
		.filter((s) => s.end > start && s.start < end)
		.map((s) => ({ start: Math.max(s.start, start) - start, end: Math.min(s.end, end) - start }));
	return { text: flat.slice(start, end), spans: inside, clippedStart: start > 0, clippedEnd: end < flat.length };
}

function shiftForWhitespace(text: string, spans: Span[]): Span[] {
	const map: number[] = [];
	let j = 0;
	let inSpace = false;
	for (let i = 0; i < text.length; i++) {
		const space = /\s/u.test(text[i]);
		map.push(j);
		if (space) {
			if (!inSpace) j++;
		} else j++;
		inSpace = space;
	}
	map.push(j);
	return spans.map((s) => ({ start: map[s.start], end: Math.max(map[s.start] + 1, map[s.end - 1] + 1) }));
}

export function highlight(subject: string | null, parts: readonly ExcerptPart[], highlights: readonly Highlight[]): Highlighted {
	const fields = new Set<Field>();
	const subjectSpans = subject ? find(subject, highlights, Field.subject) : [];
	if (subjectSpans.length) fields.add(Field.subject);
	let best: { part: ExcerptPart; spans: Span[]; rank: number } | null = null;
	for (const part of parts) {
		if (part.field === Field.subject) continue;
		const spans = find(part.text, highlights, part.field);
		if (!spans.length) continue;
		fields.add(part.field);
		const rank = PREFERENCE.indexOf(part.field);
		if (rank < 0) continue;
		if (!best || rank < best.rank || (rank === best.rank && spans.length > best.spans.length)) best = { part, spans, rank };
	}
	let excerpt: Excerpt | null = null;
	if (best) {
		const c = clip(best.part.text, best.spans);
		excerpt = { ...c, field: best.part.field, attachmentId: best.part.attachmentId, locator: best.part.locator };
	} else {
		const body = parts.find((p) => p.field === Field.body && p.text.trim());
		if (body) {
			const c = clip(body.text, []);
			excerpt = { ...c, field: null, attachmentId: null, locator: null };
		}
	}
	return { subject: subjectSpans, excerpt, fields: [...fields].sort((a, b) => a - b) };
}
