import { Field } from '../sqlite/types';

export const RECIPE = {
	version: 1,
	prefix: 'passage:',
	queryPrefix: 'query:',
	context: 48,
	content: 384,
	overlap: 48,
	total: 512,
	maxPassages: 1024,
	fields: [Field.body, Field.quoted, Field.signature, Field.attachmentText]
} as const;

const EMBEDDED_FIELDS = new Set<number>(RECIPE.fields);

export interface Tokenize {
	(text: string): number[];
}

export interface Specials {
	cls: number;
	sep: number;
}

export interface SourcePart {
	ordinal: number;
	field: Field;
	text: string;
	attachmentId: string | null;
	place: string | null;
}

export interface PassageRef {
	part: number;
	start: number;
	end: number;
}

export interface Passage {
	field: Field;
	attachmentId: string | null;
	place: string | null;
	ids: number[];
	refs: PassageRef[];
}

export type Chunked = { ok: true; passages: Passage[] } | { ok: false; reason: 'tooMany' };

interface Slice {
	part: number;
	field: Field;
	place: string | null;
	start: number;
	end: number;
	ids: number[];
}

const PARAGRAPH = /\n[ \t\r\f\v]*\n\s*/g;
const SENTENCE = /[.!?。！？…]+["'”’»)\]]*\s+/gu;

function boundaries(text: string, pattern: RegExp, from: number, to: number): number[] {
	const out: number[] = [];
	for (const m of text.slice(from, to).matchAll(pattern)) out.push(from + m.index + m[0].length);
	return out;
}

export function units(text: string): { start: number; end: number }[] {
	const out: { start: number; end: number }[] = [];
	const push = (start: number, end: number) => {
		while (start < end && /\s/.test(text[start])) start++;
		while (end > start && /\s/.test(text[end - 1])) end--;
		if (end > start) out.push({ start, end });
	};
	let paragraph = 0;
	for (const cut of [...boundaries(text, PARAGRAPH, 0, text.length), text.length]) {
		let sentence = paragraph;
		for (const s of [...boundaries(text, SENTENCE, paragraph, cut), cut]) {
			push(sentence, s);
			sentence = s;
		}
		paragraph = cut;
	}
	return out;
}

function sliced(part: SourcePart, tokenize: Tokenize): Slice[] {
	const piece = RECIPE.content - RECIPE.overlap;
	const out: Slice[] = [];
	for (const u of units(part.text)) {
		const ids = tokenize(part.text.slice(u.start, u.end));
		if (ids.length === 0) continue;
		const base = { part: part.ordinal, field: part.field, place: part.place, start: u.start, end: u.end };
		if (ids.length <= RECIPE.content) {
			out.push({ ...base, ids });
			continue;
		}
		for (let at = 0; at < ids.length; at += piece) out.push({ ...base, ids: ids.slice(at, at + piece) });
	}
	return out;
}

function tail(slices: Slice[]): Slice[] {
	const out: Slice[] = [];
	let size = 0;
	for (let i = slices.length - 1; i >= 0; i--) {
		if (size + slices[i].ids.length > RECIPE.overlap) break;
		out.unshift(slices[i]);
		size += slices[i].ids.length;
	}
	if (out.length === 0 && slices.length) {
		const last = slices[slices.length - 1];
		out.push({ ...last, ids: last.ids.slice(-RECIPE.overlap) });
	}
	return out;
}

function pack(slices: Slice[]): Slice[][] {
	const chunks: Slice[][] = [];
	let current: Slice[] = [];
	let size = 0;
	for (const s of slices) {
		if (current.length && size + s.ids.length > RECIPE.content) {
			chunks.push(current);
			current = tail(current);
			size = current.reduce((n, c) => n + c.ids.length, 0);
			if (size + s.ids.length > RECIPE.content) {
				current = [];
				size = 0;
			}
		}
		current.push(s);
		size += s.ids.length;
	}
	if (current.length) chunks.push(current);
	return chunks;
}

function refsOf(chunk: Slice[]): PassageRef[] {
	const out: PassageRef[] = [];
	for (const s of chunk) {
		const last = out[out.length - 1];
		if (last && last.part === s.part) {
			last.start = Math.min(last.start, s.start);
			last.end = Math.max(last.end, s.end);
		} else out.push({ part: s.part, start: s.start, end: s.end });
	}
	return out;
}

export function modelInput(specials: Specials, prefix: readonly number[], context: readonly number[], content: readonly number[]): number[] {
	const ids = [specials.cls, ...prefix, ...context.slice(0, RECIPE.context), ...content, specials.sep];
	if (content.length > RECIPE.content || ids.length > RECIPE.total) throw new RangeError('passage over the token limit');
	return ids;
}

export function chunk(subject: string | null, parts: readonly SourcePart[], tokenize: Tokenize, specials: Specials): Chunked {
	const prefix = tokenize(RECIPE.prefix);
	const context = subject ? tokenize(subject).slice(0, RECIPE.context) : [];
	const groups = new Map<string, SourcePart[]>();
	for (const p of parts) {
		if (!EMBEDDED_FIELDS.has(p.field) || !p.text.trim()) continue;
		const key = p.field === Field.attachmentText && p.attachmentId ? `a:${p.attachmentId}` : `p:${p.ordinal}`;
		const group = groups.get(key);
		if (group) group.push(p);
		else groups.set(key, [p]);
	}
	const seen = new Map<string, Passage>();
	const passages: Passage[] = [];
	for (const group of groups.values()) {
		const first = group[0];
		for (const c of pack(group.flatMap((p) => sliced(p, tokenize)))) {
			const content = c.flatMap((s) => s.ids);
			const refs = refsOf(c);
			const key = content.join(',');
			const existing = seen.get(key);
			if (existing) {
				existing.refs.push(...refs);
				continue;
			}
			if (passages.length >= RECIPE.maxPassages) return { ok: false, reason: 'tooMany' };
			const passage: Passage = {
				field: first.field,
				attachmentId: first.field === Field.attachmentText ? first.attachmentId : null,
				place: c[0].place,
				ids: modelInput(specials, prefix, context, content),
				refs
			};
			seen.set(key, passage);
			passages.push(passage);
		}
	}
	return { ok: true, passages };
}
