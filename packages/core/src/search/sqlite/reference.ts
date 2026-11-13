import type { HasValue, ParsedQuery, ProximityOperand, QueryNode, StateValue, SystemScope } from '../query/ast';
import { codePoints, foldText } from '../query/text';
import { filenameLiterals, hasUnsegmented, listKey, literals, normalize } from './analysis';
import { DIMENSION_OF, EXTENSION_MIMES, FAMILIES, ROLE_OF, WEIGHTS, bareFields, type Grouping, type QueryContext, type Sort } from './compile';
import { bounded, compareCodePoints, extension, significant } from './functions';
import { Coverage, Dimension, Field, Flag, Role, SourceKind, type SearchDocument, type SourceKey } from './types';

interface PartRow {
	doc: SearchDocument;
	field: Field;
	role: Role | null;
	text: string;
	tokens: string[];
}

interface LiteralRow {
	doc: SearchDocument;
	field: Field;
	chars: string[];
}

interface Corpus {
	parts: PartRow[];
	literals: LiteralRow[];
	partLength: number;
	literalLength: number;
}

export interface ReferenceGroup {
	key: string;
	threadId: string | null;
	matches: number;
	exact: boolean;
	score: number;
	date: number;
	best: SourceKey;
	sources: SourceKey[];
}

export interface ReferenceResult {
	matches: number;
	groups: ReferenceGroup[];
	incomplete: number;
	excluded: number;
}

const TOKEN_CHAR = /[\p{L}\p{N}\p{Co}]/u;

function foldChar(c: string): string {
	return c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function wordTokens(text: string): string[] {
	const out: string[] = [];
	let current = '';
	for (const c of normalize(text)) {
		if (TOKEN_CHAR.test(c)) current += foldChar(c);
		else if (current) {
			out.push(current);
			current = '';
		}
	}
	if (current) out.push(current);
	return out;
}

function trigramChars(text: string): string[] {
	return [...text].map(foldChar);
}

function gramCount(chars: readonly string[]): number {
	return Math.max(0, chars.length - 2);
}

function build(docs: readonly SearchDocument[]): Corpus {
	const parts: PartRow[] = [];
	const lits: LiteralRow[] = [];
	const part = (doc: SearchDocument, field: Field, text: string, role: Role | null) =>
		parts.push({ doc, field, role, text, tokens: wordTokens(text) });
	const literal = (doc: SearchDocument, field: Field, values: Iterable<string>) => {
		for (const v of values) lits.push({ doc, field, chars: trigramChars(v) });
	};
	for (const doc of docs) {
		if (doc.subject) {
			part(doc, Field.subject, doc.subject, null);
			literal(doc, Field.subject, literals(doc.subject));
		}
		for (const p of doc.participants) {
			if (p.role === Role.deliveredTo) continue;
			const address = normalize(p.address).toLowerCase();
			const text = p.name ? `${p.name} ${p.address}` : p.address;
			part(doc, Field.participant, text, p.role);
			literal(doc, Field.participant, new Set([address, ...literals(text)]));
		}
		for (const a of doc.attachments) {
			part(doc, Field.attachmentName, a.filename, null);
			literal(doc, Field.attachmentName, filenameLiterals(a.filename));
		}
		for (const p of doc.parts) {
			if (!p.text.length) continue;
			part(doc, p.field, p.text, p.field === Field.participant ? (p.locator ?? null) as Role | null : null);
			literal(doc, p.field, literals(p.text));
		}
		if (doc.messageId) literal(doc, Field.identifier, [doc.messageId]);
	}
	return {
		parts,
		literals: lits,
		partLength: parts.reduce((n, r) => n + r.tokens.length, 0),
		literalLength: lits.reduce((n, r) => n + gramCount(r.chars), 0)
	};
}

interface Phrase {
	tokens: string[];
	prefix: boolean;
}

function phraseStarts(tokens: readonly string[], phrase: Phrase): number[] {
	const out: number[] = [];
	const n = phrase.tokens.length;
	for (let i = 0; i + n <= tokens.length; i++) {
		let ok = true;
		for (let j = 0; j < n && ok; j++) {
			const last = j === n - 1;
			ok = phrase.prefix && last ? tokens[i + j].startsWith(phrase.tokens[j]) : tokens[i + j] === phrase.tokens[j];
		}
		if (ok) out.push(i);
	}
	return out;
}

function nearInstances(lists: number[][], lens: number[], distance: number): number[][] {
	const out = lists.map(() => [] as number[]);
	if (lists.some((l) => !l.length)) return out;
	const idx = lists.map(() => 0);
	const pos = (i: number) => lists[i][idx[i]];
	const advance = (i: number) => ++idx[i] >= lists[i].length;
	const ahead = (i: number) => (idx[i] + 1 < lists[i].length ? lists[i][idx[i] + 1] : Infinity);
	for (;;) {
		let max = pos(0);
		let matched: boolean;
		do {
			matched = true;
			for (let i = 0; i < lists.length; i++) {
				const min = max - lens[i] - distance;
				if (pos(i) < min || pos(i) > max) {
					matched = false;
					while (pos(i) < min) if (advance(i)) return out;
					if (pos(i) > max) max = pos(i);
				}
			}
		} while (!matched);
		for (let i = 0; i < lists.length; i++) {
			const p = pos(i);
			if (!out[i].length || out[i][out[i].length - 1] !== p) out[i].push(p);
		}
		let which = 0;
		for (let i = 1; i < lists.length; i++) if (ahead(i) < ahead(which)) which = i;
		if (advance(which)) return out;
	}
}

function disjointNear(tokens: readonly string[], left: Phrase, right: Phrase, distance: number): boolean {
	for (const a of phraseStarts(tokens, left)) {
		for (const b of phraseStarts(tokens, right)) {
			const [end, start] = a <= b ? [a + left.tokens.length, b] : [b + right.tokens.length, a];
			if (end <= start && start - end <= distance) return true;
		}
	}
	return false;
}

function bm25(freqs: readonly number[], hits: readonly number[], rows: number, length: number, avgdl: number): number {
	let score = 0;
	for (let i = 0; i < freqs.length; i++) {
		let idf = Math.log((rows - hits[i] + 0.5) / (hits[i] + 0.5));
		if (idf <= 0) idf = 1e-6;
		score += idf * ((freqs[i] * 2.2) / (freqs[i] + 1.2 * (1 - 0.75 + (0.75 * length) / avgdl)));
	}
	return -score;
}

interface LeafHits {
	score: Map<SearchDocument, number>;
	exact: boolean;
	dims: Dimension[];
	positive: boolean;
}

function substringCount(hay: readonly string[], needle: readonly string[]): number {
	let n = 0;
	for (let i = 0; i + needle.length <= hay.length; i++) {
		if (needle.every((c, j) => hay[i + j] === c)) n++;
	}
	return n;
}

function hasTokens(text: string): boolean {
	return /[\p{L}\p{N}]/u.test(text);
}

class Evaluator {
	readonly leaves = new Map<QueryNode, LeafHits>();

	constructor(
		readonly corpus: Corpus,
		readonly ctx: QueryContext
	) {}

	#add(hits: Map<SearchDocument, number>, doc: SearchDocument, score: number) {
		hits.set(doc, (hits.get(doc) ?? 0) + score);
	}

	#phrases(phrases: Phrase[], fields: readonly Field[], role: Role | null, verify: string | null, near: number | null): Map<SearchDocument, number> {
		const { parts, partLength } = this.corpus;
		const avgdl = partLength / parts.length;
		const hits = phrases.map((p) => parts.filter((r) => phraseStarts(r.tokens, p).length > 0).length);
		const out = new Map<SearchDocument, number>();
		for (const row of parts) {
			if (!fields.includes(row.field) || (role !== null && row.role !== role)) continue;
			let freqs: number[];
			if (near !== null) {
				if (!disjointNear(row.tokens, phrases[0], phrases[1], near)) continue;
				const lists = phrases.map((p) => phraseStarts(row.tokens, p));
				freqs = nearInstances(lists, phrases.map((p) => p.tokens.length), near).map((l) => l.length);
			} else {
				freqs = phrases.map((p) => phraseStarts(row.tokens, p).length);
				if (freqs.some((f) => f === 0)) continue;
			}
			if (verify !== null && !bounded(row.text, verify)) continue;
			this.#add(out, row.doc, -bm25(freqs, hits, parts.length, row.tokens.length, avgdl) * WEIGHTS[row.field]);
		}
		return out;
	}

	#trigram(needle: string, fields: readonly Field[]): Map<SearchDocument, number> {
		const { literals: rows, literalLength } = this.corpus;
		const chars = trigramChars(needle);
		const avgdl = literalLength / rows.length;
		const hits = rows.filter((r) => substringCount(r.chars, chars) > 0).length;
		const out = new Map<SearchDocument, number>();
		for (const row of rows) {
			if (!fields.includes(row.field)) continue;
			const f = substringCount(row.chars, chars);
			if (!f) continue;
			this.#add(out, row.doc, -bm25([f], [hits], rows.length, gramCount(row.chars), avgdl) * WEIGHTS[row.field]);
		}
		return out;
	}

	#scan(needle: string, fields: readonly Field[]): Map<SearchDocument, number> {
		const out = new Map<SearchDocument, number>();
		for (const row of this.corpus.parts) {
			if (fields.includes(row.field) && foldText(row.text).includes(needle)) out.set(row.doc, 0);
		}
		return out;
	}

	#unsegmented(text: string, fields: readonly Field[]): Map<SearchDocument, number> {
		return codePoints(text) >= 3 ? this.#trigram(text, fields) : this.#scan(text, fields);
	}

	#leaf(node: QueryNode, hits: Map<SearchDocument, number>, fields: readonly Field[], exact: boolean, positive: boolean): LeafHits {
		const leaf = { score: hits, exact, positive, dims: [...new Set(fields.map((f) => DIMENSION_OF[f]))] };
		this.leaves.set(node, leaf);
		return leaf;
	}

	#text(node: QueryNode, text: string, lane: 'word' | 'identifier', scoped: readonly Field[] | null, positive: boolean): LeafHits | null {
		const fields = scoped ?? bareFields(this.ctx);
		if (!hasTokens(text)) return null;
		if (hasUnsegmented(text)) return this.#leaf(node, this.#unsegmented(text, fields), fields, false, positive);
		const phrase: Phrase = { tokens: wordTokens(text), prefix: false };
		if (lane === 'identifier') {
			const hits = this.#phrases([phrase], fields, null, text, null);
			if (scoped === null && codePoints(text) >= 3) {
				const needle = trigramChars(text);
				for (const row of this.corpus.literals) {
					if (row.field !== Field.identifier || substringCount(row.chars, needle) === 0) continue;
					if (bounded(row.doc.messageId, text) && !hits.has(row.doc)) hits.set(row.doc, 0);
				}
			}
			return this.#leaf(node, hits, scoped === null ? [...fields, Field.identifier] : fields, true, positive);
		}
		return this.#leaf(node, this.#phrases([phrase], fields, null, null, null), fields, false, positive);
	}

	prepare(node: QueryNode, scoped: readonly Field[] | null, positive: boolean): void {
		const fields = scoped ?? bareFields(this.ctx);
		switch (node.kind) {
			case 'and':
			case 'or':
				node.children.forEach((c) => this.prepare(c, scoped, positive));
				return;
			case 'not':
				this.prepare(node.child, scoped, !positive);
				return;
			case 'field': {
				const map = { subject: [Field.subject], body: [Field.body, Field.quoted], attachment: [Field.attachmentText] };
				this.prepare(node.child, map[node.field], positive);
				return;
			}
			case 'term':
			case 'literal':
				this.#text(node, node.text, node.lane, scoped, positive);
				return;
			case 'phrase':
				if (!hasTokens(node.text)) return;
				if (hasUnsegmented(node.text) && !/\s/u.test(node.text)) {
					this.#leaf(node, this.#unsegmented(node.text, fields), fields, false, positive);
					return;
				}
				this.#leaf(node, this.#phrases([{ tokens: wordTokens(node.text), prefix: false }], fields, null, null, null), fields, false, positive);
				return;
			case 'prefix':
				if (!hasTokens(node.text)) return;
				if (hasUnsegmented(node.text)) {
					this.#leaf(node, this.#unsegmented(node.text, fields), fields, false, positive);
					return;
				}
				this.#leaf(node, this.#phrases([{ tokens: wordTokens(node.text), prefix: true }], fields, null, null, null), fields, false, positive);
				return;
			case 'around': {
				if (!hasTokens(node.left.text) || !hasTokens(node.right.text)) return;
				const p = (o: ProximityOperand): Phrase => ({ tokens: wordTokens(o.text), prefix: false });
				this.#leaf(node, this.#phrases([p(node.left), p(node.right)], fields, null, null, node.distance), fields, false, positive);
				return;
			}
			case 'participant':
				if (node.value.kind !== 'name' || !hasTokens(node.value.text)) return;
				this.#leaf(
					node,
					this.#phrases([{ tokens: wordTokens(node.value.text), prefix: node.value.prefix }], [Field.participant], ROLE_OF[node.role], null, null),
					[Field.participant],
					false,
					positive
				);
				return;
			default:
				return;
		}
	}

	#flag(doc: SearchDocument, bit: number, set: boolean): boolean {
		return doc.kind === SourceKind.message && (doc.knownFlags & bit) !== 0 && ((doc.flags & bit) !== 0) === set;
	}

	#flagKnown(doc: SearchDocument, bit: number): boolean {
		return doc.kind !== SourceKind.message || (doc.knownFlags & bit) !== 0;
	}

	#scopeBit(scope: SystemScope): number | null {
		const bits: Partial<Record<SystemScope, number>> = {
			inbox: Flag.inbox,
			sent: Flag.sent,
			archive: Flag.archive,
			snoozed: Flag.snoozed,
			spam: Flag.spam,
			trash: Flag.trash
		};
		return bits[scope] ?? null;
	}

	#stateBit(state: StateValue): number {
		return state === 'starred' ? Flag.starred : Flag.read;
	}

	#has(doc: SearchDocument, value: HasValue): boolean {
		const mimes = doc.attachments.map((a) => a.mime.toLowerCase());
		switch (value) {
			case 'attachment':
				return doc.attachments.some((a) => !a.inline);
			case 'image':
				return mimes.some((m) => m.startsWith('image/'));
			case 'document':
			case 'spreadsheet':
			case 'presentation':
				return mimes.some((m) => FAMILIES[value].includes(m));
			case 'userlabels':
				return doc.collections.some((c) => c.type === 'label');
			case 'nouserlabels':
				return !doc.collections.some((c) => c.type === 'label');
		}
	}

	#addresses(doc: SearchDocument, role: Role): string[] {
		return doc.participants.filter((p) => p.role === role).map((p) => normalize(p.address).toLowerCase());
	}

	#collections(doc: SearchDocument, ids: readonly string[]): boolean {
		return doc.collections.some((c) => ids.includes(c.id));
	}

	known(node: QueryNode, doc: SearchDocument): boolean {
		const leaf = this.leaves.get(node);
		if (leaf) return leaf.dims.every((d) => doc.coverage[d] === undefined || doc.coverage[d] === Coverage.complete);
		switch (node.kind) {
			case 'and':
			case 'or':
				return node.children.every((c) => this.known(c, doc));
			case 'not':
			case 'field':
				return this.known(node.child, doc);
			case 'scope': {
				const bit = this.#scopeBit(node.scope);
				return bit === null || this.#flagKnown(doc, bit);
			}
			case 'state':
				return this.#flagKnown(doc, this.#stateBit(node.state));
			default:
				return true;
		}
	}

	test(node: QueryNode, doc: SearchDocument): boolean {
		const leaf = this.leaves.get(node);
		if (leaf) return leaf.score.has(doc);
		switch (node.kind) {
			case 'and':
				return node.children.every((c) => this.test(c, doc));
			case 'or':
				return node.children.some((c) => this.test(c, doc));
			case 'not':
				return !this.test(node.child, doc) && this.known(node.child, doc);
			case 'field':
				return this.test(node.child, doc);
			case 'term':
			case 'literal':
			case 'phrase':
			case 'prefix':
			case 'around':
				return false;
			case 'participant': {
				const role = ROLE_OF[node.role];
				if (node.value.kind === 'name') return false;
				const wanted = node.value.kind === 'me' ? this.ctx.identities.map((a) => foldText(a.trim())) : [node.value.address];
				return this.#addresses(doc, role).some((a) => wanted.includes(a));
			}
			case 'filename':
				return doc.attachments.some((a) => foldText(a.filename).includes(node.text));
			case 'filetype': {
				const mimes = [...(EXTENSION_MIMES[node.text] ?? []), ...(Object.hasOwn(FAMILIES, node.text) ? FAMILIES[node.text as keyof typeof FAMILIES] : [])];
				return doc.attachments.some((a) => {
					const mime = a.mime.toLowerCase();
					return extension(a.filename) === node.text || mimes.includes(mime) || (node.text === 'image' && mime.startsWith('image/'));
				});
			}
			case 'has':
				return this.#has(doc, node.value);
			case 'scope': {
				if (node.scope === 'anywhere') return true;
				if (node.scope === 'drafts') return doc.kind === SourceKind.draft;
				if (node.scope === 'scheduled') return doc.kind === SourceKind.scheduled;
				return this.#flag(doc, this.#scopeBit(node.scope)!, true);
			}
			case 'folder': {
				const target = foldText(node.path);
				const ids = this.ctx.folders.filter((f) => foldText(f.path) === target || foldText(f.path).startsWith(`${target}/`)).map((f) => f.id);
				return this.#collections(doc, ids);
			}
			case 'label': {
				const target = foldText(node.name);
				return this.#collections(doc, this.ctx.labels.filter((l) => foldText(l.name) === target).map((l) => l.id));
			}
			case 'state':
				return this.#flag(doc, this.#stateBit(node.state), node.state !== 'unread');
			case 'date':
				return node.bound === 'after' ? doc.date >= node.at : doc.date < node.at;
			case 'size':
				return node.op === 'gt' ? doc.size > node.bytes : doc.size < node.bytes;
			case 'deliveredto':
				return this.#addresses(doc, Role.deliveredTo).includes(node.address);
			case 'list':
				return (doc.listId ? listKey(doc.listId) : null) === node.value;
			case 'msgid':
				return doc.messageId === node.id || doc.messageId === `<${node.id}>`;
		}
	}

	hasLeaf(node: QueryNode): boolean {
		if (this.leaves.has(node)) return true;
		switch (node.kind) {
			case 'and':
			case 'or':
				return node.children.some((c) => this.hasLeaf(c));
			case 'not':
			case 'field':
				return this.hasLeaf(node.child);
			default:
				return false;
		}
	}
}

function conjuncts(node: QueryNode): QueryNode[] {
	if (node.kind === 'and') return node.children.flatMap(conjuncts);
	if (node.kind === 'field' && node.child.kind === 'and') return node.child.children.flatMap(conjuncts);
	return [node];
}

function key(doc: SearchDocument, group: Grouping): string {
	if (group === 'thread' && doc.kind === SourceKind.message && doc.threadId !== null) return `t${doc.threadId}`;
	return `${doc.kind}:${doc.sourceId}`;
}

interface Hit {
	doc: SearchDocument;
	tier: number;
	score: number;
}

function comparator(sort: Sort): (a: Hit, b: Hit) => number {
	const tail = (a: Hit, b: Hit) => a.doc.kind - b.doc.kind || compareCodePoints(a.doc.sourceId, b.doc.sourceId);
	switch (sort) {
		case 'relevance':
			return (a, b) => b.tier - a.tier || b.score - a.score || b.doc.date - a.doc.date || tail(a, b);
		case 'newest':
			return (a, b) => b.doc.date - a.doc.date || tail(a, b);
		case 'oldest':
			return (a, b) => a.doc.date - b.doc.date || tail(a, b);
	}
}

export function referenceSearch(
	docs: readonly SearchDocument[],
	query: ParsedQuery,
	ctx: QueryContext,
	options: { sort: Sort; group: Grouping }
): ReferenceResult {
	const evaluator = new Evaluator(build(docs), ctx);
	const root = query.root;
	if (root) evaluator.prepare(root, null, true);
	let mask = Flag.spam | Flag.trash;
	if (query.universe.includes('spam')) mask &= ~Flag.spam;
	if (query.universe.includes('trash')) mask &= ~Flag.trash;
	const inUniverse = (d: SearchDocument) => d.kind !== SourceKind.message || (d.flags & mask) === 0;
	const filters = root ? conjuncts(root).filter((c) => !evaluator.hasLeaf(c)) : [];
	const leaves = [...evaluator.leaves.values()];
	const positive = leaves.filter((l) => l.positive);
	const dims = [...new Set(leaves.flatMap((l) => l.dims))];
	let incomplete = 0;
	let excluded = 0;
	const hits: Hit[] = [];
	for (const doc of docs) {
		if (!inUniverse(doc)) continue;
		if (dims.length && filters.every((f) => evaluator.test(f, doc))) {
			const states = dims.map((d) => doc.coverage[d]).filter((s) => s !== undefined);
			if (states.some((s) => s !== Coverage.complete && s !== Coverage.excludedByUser)) incomplete++;
			if (states.some((s) => s === Coverage.excludedByUser)) excluded++;
		}
		if (root && !evaluator.test(root, doc)) continue;
		let score = 0;
		for (const l of positive) score += l.score.get(doc) ?? 0;
		hits.push({ doc, tier: positive.some((l) => l.exact && l.score.has(doc)) ? 1 : 0, score: significant(score) });
	}
	const order = comparator(options.sort);
	const grouped = new Map<string, Hit[]>();
	for (const h of hits) {
		const k = key(h.doc, options.group);
		if (!grouped.has(k)) grouped.set(k, []);
		grouped.get(k)!.push(h);
	}
	const groups = [...grouped.entries()].map(([k, members]) => {
		members.sort(order);
		return { k, members };
	});
	groups.sort((a, b) => order(a.members[0], b.members[0]));
	return {
		matches: hits.length,
		incomplete,
		excluded,
		groups: groups.map(({ k, members }) => {
			const best = members[0];
			return {
				key: k,
				threadId: best.doc.kind === SourceKind.message ? best.doc.threadId : null,
				matches: members.length,
				exact: best.tier === 1,
				score: best.score,
				date: best.doc.date,
				best: { kind: best.doc.kind, sourceId: best.doc.sourceId },
				sources: members.map((m) => ({ kind: m.doc.kind, sourceId: m.doc.sourceId }))
			};
		})
	};
}
