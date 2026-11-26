import type { BindValue, CApi, Database, SqlValue } from '@thelemail/sqlite-wasm';
import type { ParsedQuery, QueryError } from '../query/ast';
import { meaningSplit } from '../query/classify';
import { fuse, type Channel, type Ranked } from '../fusion/fuse';
import { DIMENSIONS } from '../model/pool';
import { decoded, type VectorCache } from '../vectors/cache';
import { quantize } from '../vectors/matrix';
import { GroupHeap } from '../vectors/topk';
import { SQLITE_INTERRUPT, resultCode } from './capi';
import {
	WEIGHTS,
	compile,
	coverageFragments,
	quote,
	render,
	universeOf,
	usedDimensions,
	type Fragment,
	type Grouping,
	type Highlight,
	type Resolution,
	type Plan,
	type QueryContext,
	type Sort,
	type Step
} from './compile';
import { highlight, type Excerpt, type ExcerptPart, type Span } from './excerpt';
import { bounded, registerFunctions, significant } from './functions';
import { suggest, type Suggestion } from './suggest';
import { Tokenizer, nearWithin } from './tokenizer';
import { COLLECTION_TYPE } from './writer';
import { Coverage, Dimension, Field, Role, SourceKind, type SourceKey } from './types';

export const PAGE_SIZE = 50;
export const SELECTIVE = 2000;
const TARGET_MS = 12;
const STATEMENT_MS = 40;
const PROGRESS_OPS = 1000;
const FIRST_SLICE = 2048;
const MAX_SLICE = 1 << 20;
const MIN_SLICE = 64;
const FILL_BATCH = 4096;
const PROVISIONAL_MS = 120;
const PROGRESS_EVERY_MS = 250;
const PART_CHARS = 100_000;
const RECIPIENTS = 3;
const COMPLETIONS = 8;
export const MEANING_GROUPS = 1000;
const CANDIDATE_GROUPS = 2000;
const CANDIDATE_PASSAGES = 4;
const RESCORE_GROUPS = 256;
const RESCORE_MARGIN = 0.02;
const RESCORE_BATCH = 512;
const SCAN_ROWS = 8192;
const PASSAGE_CHARS = 400;

export interface QueryOptions {
	sort: Sort;
	group: Grouping;
	signal?: AbortSignal;
	strategy?: 'auto' | 'scan' | 'candidates';
	onProgress?: (progress: Provisional) => void;
}

export interface Provisional {
	matches: number;
	groups: number;
	rows: ResultRow[] | null;
}

export interface QuerySummary {
	id: number;
	matches: number;
	groups: number;
	pages: number;
	incomplete: number;
	excluded: number;
	suggestions: Suggestion[];
	generation: number;
	dims: Dimension[];
	resolved: Resolution[];
}

export type QueryOutcome = { ok: true; summary: QuerySummary } | { ok: false; error: QueryError };

export interface MeaningEpoch {
	epoch: number;
	current: boolean;
	rebuilding: boolean;
}

export interface MeaningOptions {
	group: Grouping;
	vector: Float32Array;
	epoch: MeaningEpoch;
	cache: VectorCache;
	exclude?: number;
	signal?: AbortSignal;
}

export interface MeaningSummary {
	id: number;
	groups: number;
	pages: number;
	eligible: number;
	incomplete: number;
	capped: number;
	scanned: number;
	rebuilding: boolean;
	generation: number;
	resolved: Resolution[];
}

export type MeaningOutcome = { ok: true; summary: MeaningSummary } | { ok: false; error: QueryError } | { ok: false; reason: 'words' | 'stale' };

export interface MatchedPassage {
	field: Field;
	attachmentId: string | null;
	place: string | null;
	text: string;
}

export interface ResultGroup {
	key: string;
	threadId: string | null;
	matches: number;
	exact: boolean;
	score: number;
	date: number;
	best: SourceKey;
	sources: SourceKey[];
}

export interface Person {
	name: string;
	address: string;
}

export interface ResultRow extends ResultGroup {
	subject: string | null;
	subjectSpans: Span[];
	from: Person | null;
	to: Person[];
	flags: number;
	knownFlags: number;
	attachments: number;
	folders: string[];
	labels: string[];
	excerpt: Excerpt | null;
	filename: string | null;
	fields: Field[];
	passage?: MatchedPassage;
	channel?: Channel;
}

export type PageResult = { ok: true; groups: ResultRow[] } | { ok: false; reason: 'invalidated' | 'closed' };

export interface Completions {
	terms: string[];
	people: Person[];
}

interface Session {
	prefix: string;
	sort: Sort;
	group: Grouping;
	parent?: number;
	channels?: Map<string, Channel>;
	tables: string[];
	invalid: boolean;
	summary: QuerySummary | null;
	highlights: Highlight[];
	generation: number;
	passages?: Map<string, { epoch: number; source: number; ordinal: number }>;
}

interface Rescored {
	group: number;
	source: number;
	ordinal: number;
	score: number;
}

function dot(a: Float32Array, b: Float32Array): number {
	let sum = 0;
	for (let d = 0; d < DIMENSIONS; d++) sum += a[d] * b[d];
	return sum;
}

const ORDER: Readonly<Record<Sort, readonly (readonly [string, boolean])[]>> = {
	relevance: [
		['tier', true],
		['score', true],
		['date', true],
		['kind', false],
		['sid', false]
	],
	newest: [
		['date', true],
		['kind', false],
		['sid', false]
	],
	oldest: [
		['date', false],
		['kind', false],
		['sid', false]
	]
};

const GROUP_KEY: Readonly<Record<Grouping, string>> = {
	thread: `CASE WHEN s.kind = ${SourceKind.message} AND s.thread_id IS NOT NULL THEN 't' || s.thread_id ELSE s.kind || ':' || s.source_id END`,
	message: `s.kind || ':' || s.source_id`
};

function orderBy(sort: Sort): string {
	return ORDER[sort].map(([col, desc]) => `${col}${desc ? ' DESC' : ''}`).join(', ');
}

function better(sort: Sort): string {
	const cols = ORDER[sort];
	const side = (prefix: string) => cols.map(([col, desc]) => `${desc ? '-' : ''}${prefix}${col}`).join(', ');
	return `(${side('excluded.')}) < (${side('')})`;
}

function placeholders(n: number): string {
	return Array.from({ length: n }, () => '?').join(', ');
}

function and(parts: Fragment[]): Fragment {
	if (!parts.length) return { sql: '1', params: [] };
	return { sql: parts.map((p) => `(${p.sql})`).join(' AND '), params: parts.flatMap((p) => p.params) };
}

export function yieldTask(): Promise<void> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			channel.port1.close();
			resolve();
		};
		channel.port2.postMessage(null);
	});
}

export class QueryEngine {
	#db: Database;
	#capi: CApi;
	#tokenizer: Tokenizer;
	#next = 0;
	#sessions = new Map<number, Session>();
	#deadline = Infinity;
	#slices = new Map<string, number>();
	generation = 0;

	constructor(db: Database, capi: CApi) {
		this.#db = db;
		this.#capi = capi;
		this.#tokenizer = new Tokenizer(db);
		registerFunctions(db);
		capi.sqlite3_progress_handler(db.pointer!, PROGRESS_OPS, () => (performance.now() > this.#deadline ? 1 : 0), 0);
	}

	async run(query: ParsedQuery, ctx: QueryContext, options: QueryOptions): Promise<QueryOutcome> {
		const compiled = compile(query, ctx);
		if (!compiled.ok) return compiled;
		const id = ++this.#next;
		const session: Session = { prefix: `temp.q${id}`, sort: options.sort, group: options.group, tables: [], invalid: false, summary: null, highlights: compiled.plan.highlights, generation: this.generation };
		this.#sessions.set(id, session);
		try {
			const summary = await this.#execute(id, session, compiled.plan, options);
			session.summary = summary;
			return { ok: true, summary };
		} catch (err) {
			this.close(id);
			throw err;
		}
	}

	async meaning(query: ParsedQuery, ctx: QueryContext, options: MeaningOptions): Promise<MeaningOutcome> {
		const split = meaningSplit(query.root);
		if (!split) return { ok: false, reason: 'words' };
		const excluded = options.exclude === undefined ? null : this.#sessions.get(options.exclude);
		if (excluded !== null && (!excluded?.summary || excluded.invalid || excluded.group !== options.group)) return { ok: false, reason: 'stale' };
		const compiled = compile({ ...query, root: split.rest }, ctx);
		if (!compiled.ok) return compiled;
		const lexical = compile({ ...query, root: split.lexical }, ctx);
		if (!lexical.ok) return lexical;
		const id = ++this.#next;
		const session: Session = {
			prefix: `temp.q${id}`,
			sort: 'relevance',
			group: options.group,
			parent: options.exclude,
			tables: [],
			invalid: false,
			summary: null,
			highlights: lexical.plan.highlights,
			generation: this.generation,
			passages: new Map(),
			channels: new Map()
		};
		this.#sessions.set(id, session);
		try {
			const summary = await this.#meaning(id, session, compiled.plan, { ...lexical.plan, suggestible: [] }, excluded?.prefix ?? null, options);
			session.summary = { id, matches: summary.groups, groups: summary.groups, pages: summary.pages, incomplete: summary.incomplete, excluded: 0, suggestions: [], generation: summary.generation, dims: [Dimension.semantic], resolved: summary.resolved };
			return { ok: true, summary };
		} catch (err) {
			this.close(id);
			throw err;
		}
	}

	page(id: number, index: number): PageResult {
		const session = this.#sessions.get(id);
		if (!session?.summary) return { ok: false, reason: 'closed' };
		if (session.invalid) return { ok: false, reason: 'invalidated' };
		return { ok: true, groups: this.#atomic(() => this.#rows(session, index)) };
	}

	#rows(session: Session, index: number): ResultRow[] {
		const p = session.prefix;
		const rows = this.#db.selectArrays(
			`SELECT grp, thread, n, tier, score, date, kind, sid FROM ${p}_g ORDER BY ${orderBy(session.sort)} LIMIT ? OFFSET ?`,
			[PAGE_SIZE, index * PAGE_SIZE]
		);
		const members = new Map<string, SourceKey[]>();
		if (rows.length) {
			const keys = rows.map((r) => r[0] as string);
			const list = this.#db.selectArrays(
				`SELECT grp, kind, sid FROM ${p}_m WHERE grp IN (${placeholders(keys.length)}) ORDER BY grp, ${orderBy(session.sort)}`,
				keys
			);
			for (const [grp, kind, sid] of list) {
				const key = grp as string;
				if (!members.has(key)) members.set(key, []);
				members.get(key)!.push({ kind: kind as SourceKind, sourceId: sid as string });
			}
		}
		return rows.map(([grp, thread, n, tier, score, date, kind, sid]) =>
			this.#hydrate(
				{
					key: grp as string,
					threadId: thread as string | null,
					matches: n as number,
					exact: tier === 1,
					score: score as number,
					date: date as number,
					best: { kind: kind as SourceKind, sourceId: sid as string },
					sources: members.get(grp as string) ?? []
				},
				session.highlights
			)
		).map((row) => {
			const at = session.passages?.get(row.key);
			const passage = at ? this.#passage(at.epoch, at.source, at.ordinal) : null;
			const channel = session.channels?.get(row.key);
			return { ...row, ...(passage ? { passage } : {}), ...(channel ? { channel } : {}) };
		});
	}

	#passage(epoch: number, source: number, ordinal: number): MatchedPassage | null {
		const head = this.#db.selectArray('SELECT field, attachment_id, place FROM passages WHERE epoch = ? AND source = ? AND ordinal = ?', [epoch, source, ordinal]) as
			| [number, string | null, string | null]
			| undefined;
		if (!head) return null;
		const ref = this.#db.selectArray(
			'SELECT p.text, r.start, r.end FROM passage_refs r JOIN parts p ON p.id = r.part WHERE r.epoch = ? AND r.source = ? AND r.ordinal = ? ORDER BY r.part, r.start LIMIT 1',
			[epoch, source, ordinal]
		) as [string, number, number] | undefined;
		const text = ref ? ref[0].slice(ref[1], Math.min(ref[2], ref[1] + PASSAGE_CHARS)) : '';
		return { field: head[0] as Field, attachmentId: head[1], place: head[2], text };
	}

	#hydrate(group: ResultGroup, highlights: readonly Highlight[]): ResultRow {
		const head = this.#db.selectArray('SELECT id, flags, known_flags FROM sources WHERE kind = ? AND source_id = ?', [group.best.kind, group.best.sourceId]) as
			| [number, number, number]
			| undefined;
		const empty: ResultRow = { ...group, subject: null, subjectSpans: [], from: null, to: [], flags: 0, knownFlags: 0, attachments: 0, folders: [], labels: [], excerpt: null, filename: null, fields: [] };
		if (!head) return empty;
		const [id, flags, knownFlags] = head;
		const parts: ExcerptPart[] = [];
		let subject: string | null = null;
		for (const [field, text, attachmentId, locator, place] of this.#db.selectArrays(
			'SELECT field, substr(text, 1, ?), attachment_id, locator, place FROM parts WHERE source = ? AND field != ? ORDER BY id',
			[PART_CHARS, id, Field.participant]
		)) {
			if (field === Field.subject) subject ??= text as string;
			else parts.push({ field: field as Field, text: text as string, attachmentId: attachmentId as string | null, locator: locator as number | null, place: place as string | null });
		}
		const people = this.#db.selectArrays('SELECT role, name, address FROM participants WHERE source = ? AND role IN (?, ?) ORDER BY rowid', [id, Role.from, Role.to]) as [
			number,
			string,
			string
		][];
		const fromRow = people.find((r) => r[0] === Role.from);
		const to = people.filter((r) => r[0] === Role.to).slice(0, RECIPIENTS).map(([, name, address]) => ({ name, address }));
		const attachments = Number(this.#db.selectValue('SELECT count(*) FROM attachments WHERE source = ? AND inline = 0', [id]));
		const folders: string[] = [];
		const labels: string[] = [];
		for (const [collection, type] of this.#db.selectArrays('SELECT collection_id, type FROM collections WHERE source = ?', [id]) as [string, number][]) {
			(type === COLLECTION_TYPE.label ? labels : folders).push(collection);
		}
		const lit = highlight(subject, parts, highlights);
		const attachmentId = lit.excerpt?.attachmentId ?? null;
		const filename = attachmentId
			? ((this.#db.selectValue('SELECT filename FROM attachments WHERE source = ? AND attachment_id = ?', [id, attachmentId]) as string | undefined) ?? null)
			: null;
		return {
			...group,
			subject,
			subjectSpans: lit.subject,
			from: fromRow ? { name: fromRow[1], address: fromRow[2] } : null,
			to,
			flags,
			knownFlags,
			attachments,
			folders,
			labels,
			excerpt: lit.excerpt,
			filename,
			fields: lit.fields
		};
	}

	complete(prefix: string): Completions {
		const tokens = this.#tokenizer.tokens(prefix);
		const last = tokens[tokens.length - 1];
		const terms: string[] = [];
		if (last && [...last].length >= 2) {
			this.#db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS temp.tl_vocab USING fts5vocab (main, parts_fts, row)');
			const rows = this.#db.selectArrays('SELECT term, doc FROM temp.tl_vocab WHERE term >= ? AND term < ? LIMIT 200', [last, `${last}\u{10FFFF}`]) as [string, number][];
			rows.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
			for (const [term] of rows) if (term !== last && terms.length < COMPLETIONS) terms.push(term);
		}
		const needle = prefix.trim().toLowerCase();
		const people: Person[] = [];
		if ([...needle].length >= 2) {
			const seen = new Set<string>();
			const add = (rows: unknown[][]) => {
				for (const [name, address] of rows as [string, string][]) {
					if (seen.has(address) || people.length >= COMPLETIONS) continue;
					seen.add(address);
					people.push({ name, address });
				}
			};
			add(
				this.#db.selectArrays(
					'SELECT name, address FROM participants WHERE address >= ? AND address < ? AND role != ? GROUP BY address ORDER BY count(*) DESC LIMIT ?',
					[needle, `${needle}\u{10FFFF}`, Role.deliveredTo, COMPLETIONS]
				)
			);
			if (last && people.length < COMPLETIONS) {
				add(
					this.#db.selectArrays(
						`SELECT p.name, p.address FROM participants p WHERE p.role != ? AND p.source IN (
							SELECT source FROM parts_fts WHERE parts_fts MATCH ? AND field = ? LIMIT 200)
						AND instr(tl_fold(p.name), tl_fold(?)) > 0 GROUP BY p.address ORDER BY count(*) DESC LIMIT ?`,
						[Role.deliveredTo, `${quote(last)} *`, Field.participant, last, COMPLETIONS]
					)
				);
			}
		}
		return { terms, people };
	}

	close(id: number): void {
		const session = this.#sessions.get(id);
		if (!session) return;
		this.#sessions.delete(id);
		this.#drop(session);
		for (const [child, s] of [...this.#sessions]) if (s.parent === id) this.close(child);
	}

	invalidate(source: number): void {
		for (const session of this.#sessions.values()) {
			if (session.invalid || !session.tables.includes(`${session.prefix}_m`)) continue;
			if (this.#db.selectValue(`SELECT 1 FROM ${session.prefix}_m WHERE source = ?`, [source])) session.invalid = true;
		}
		for (const session of this.#sessions.values()) {
			if (session.parent !== undefined && this.#sessions.get(session.parent)?.invalid) session.invalid = true;
		}
	}

	dispose(): void {
		for (const id of [...this.#sessions.keys()]) this.close(id);
		this.#tokenizer.dispose();
		if (this.#db.isOpen()) {
			this.#db.exec('DROP TABLE IF EXISTS temp.tl_vocab');
			this.#capi.sqlite3_progress_handler(this.#db.pointer!, 0, 0, 0);
		}
	}

	#drop(session: Session): void {
		if (!this.#db.isOpen()) return;
		for (const table of session.tables.reverse()) this.#db.exec(`DROP TABLE IF EXISTS ${table}`);
		session.tables = [];
	}

	#table(session: Session, name: string, columns: string, indexes: string[] = []): string {
		const table = `${session.prefix}_${name}`;
		this.#db.exec(`CREATE TABLE ${table} (${columns})`);
		session.tables.push(table);
		indexes.forEach((cols, i) => this.#db.exec(`CREATE INDEX ${table}_i${i} ON ${table.slice(5)} (${cols})`));
		return table;
	}

	#exec(sql: string, params: readonly BindValue[]): number {
		this.#db.exec({ sql, bind: params as BindValue[] });
		return Number(this.#db.changes());
	}

	#atomic<T>(fn: () => T): T {
		this.#db.exec('BEGIN');
		try {
			const value = fn();
			this.#db.exec('COMMIT');
			return value;
		} catch (err) {
			if (!this.#capi.sqlite3_get_autocommit(this.#db.pointer!)) this.#db.exec('ROLLBACK');
			throw err;
		}
	}

	#guarded<T>(fn: () => T, limit: boolean): { ok: true; value: T } | { ok: false } {
		this.#deadline = limit ? performance.now() + STATEMENT_MS : Infinity;
		try {
			return { ok: true, value: fn() };
		} catch (err) {
			if (limit && resultCode(err) === SQLITE_INTERRUPT) return { ok: false };
			throw err;
		} finally {
			this.#deadline = Infinity;
		}
	}

	async #sliced(kind: string, range: readonly [number, number], checkpoint: () => Promise<void>, run: (lo: number, hi: number) => void): Promise<void> {
		let size = this.#slices.get(kind) ?? FIRST_SLICE;
		const [lo, hi] = range;
		for (let a = lo; a <= hi; ) {
			await checkpoint();
			const b = Math.min(hi, a + size - 1);
			const started = performance.now();
			const outcome = this.#guarded(() => run(a, b), size > MIN_SLICE);
			if (!outcome.ok) {
				size = Math.max(MIN_SLICE, size >> 1);
				continue;
			}
			const took = performance.now() - started;
			if (took < TARGET_MS / 2) size = Math.min(MAX_SLICE, size * 2);
			else if (took > TARGET_MS * 2) size = Math.max(MIN_SLICE, size >> 1);
			a = b + 1;
		}
		this.#slices.set(kind, size);
	}

	#range(table: string): [number, number] {
		const row = this.#db.selectArray(`SELECT (SELECT min(rowid) FROM ${table}), (SELECT max(rowid) FROM ${table})`) as SqlValue[];
		return row[0] === null ? [1, 0] : [Number(row[0]), Number(row[1])];
	}

	async #execute(id: number, session: Session, plan: Plan, options: QueryOptions): Promise<QuerySummary> {
		const signal = options.signal;
		const checkpoint = async () => {
			signal?.throwIfAborted();
			await yieldTask();
			signal?.throwIfAborted();
		};
		const universe = universeOf(plan);
		const filters = and([universe, ...plan.filters.map((f) => render(f, plan, () => ''))]);
		const sources = this.#range('sources');

		let candidates: string | null = null;
		if (plan.filters.length && options.strategy !== 'scan') {
			const table = this.#table(session, 'c', 'source INTEGER PRIMARY KEY');
			let count = 0;
			await this.#sliced('sources', sources, checkpoint, (lo, hi) => {
				count += this.#exec(`INSERT INTO ${table} (source) SELECT s.id FROM sources s WHERE s.id BETWEEN ? AND ? AND ${filters.sql}`, [
					lo,
					hi,
					...filters.params
				]);
			});
			if (count < SELECTIVE || options.strategy === 'candidates') candidates = table;
		}
		const scope = candidates ? this.#range(candidates) : sources;

		const leafTables: string[] = [];
		for (const [k, leaf] of plan.leaves.entries()) {
			const table = this.#table(session, `l${k}`, 'source INTEGER PRIMARY KEY, score REAL NOT NULL');
			leafTables.push(table);
			for (const step of leaf.steps) await this.#step(step, table, candidates, scope, checkpoint);
		}

		const table = (leaf: number) => leafTables[leaf];
		const expr = render(plan.expr, plan, table);
		const positive = plan.leaves.flatMap((l, k) => (l.positive ? [k] : []));
		const exact = positive.filter((k) => plan.leaves[k].exact);
		const score = positive.length ? positive.map((k) => `coalesce((SELECT score FROM ${table(k)} WHERE source = s.id), 0)`).join(' + ') : '0';
		const tier = exact.length ? `(${exact.map((k) => `EXISTS (SELECT 1 FROM ${table(k)} WHERE source = s.id)`).join(' OR ')})` : '0';
		const sort = session.sort;
		const order = orderBy(sort);
		const matches = this.#table(session, 'm', 'source INTEGER PRIMARY KEY, grp TEXT NOT NULL, thread TEXT, tier INTEGER NOT NULL, score REAL NOT NULL, date INTEGER NOT NULL, kind INTEGER NOT NULL, sid TEXT NOT NULL', [`grp, ${order}`]);
		const groups = this.#table(session, 'g', 'grp TEXT PRIMARY KEY, thread TEXT, n INTEGER NOT NULL, tier INTEGER NOT NULL, score REAL NOT NULL, date INTEGER NOT NULL, kind INTEGER NOT NULL, sid TEXT NOT NULL', [order]);
		const from = candidates ? `${candidates} c JOIN sources s ON s.id = c.source WHERE c.source BETWEEN ? AND ?` : 'sources s WHERE s.id BETWEEN ? AND ?';
		const insertMatches = `INSERT INTO ${matches} (source, grp, thread, tier, score, date, kind, sid)
			SELECT s.id, ${GROUP_KEY[options.group]}, CASE WHEN s.kind = ${SourceKind.message} THEN s.thread_id END, ${tier}, tl_sig(${score}), s.date, s.kind, s.source_id
			FROM ${from} AND ${universe.sql} AND ${expr.sql}`;
		const pick = (col: string) => `${col} = CASE WHEN ${better(sort)} THEN excluded.${col} ELSE ${col} END`;
		const upsertGroups = `INSERT INTO ${groups} (grp, thread, n, tier, score, date, kind, sid)
			SELECT grp, thread, 1, tier, score, date, kind, sid FROM ${matches} WHERE source BETWEEN ? AND ?
			ON CONFLICT (grp) DO UPDATE SET n = n + 1, ${['tier', 'score', 'date', 'kind', 'sid'].map(pick).join(', ')}`;
		const dims = usedDimensions(plan);
		const coverage = dims.length ? coverageFragments(dims) : null;
		const coverageSql = coverage
			? `SELECT coalesce(sum(${coverage.incomplete.sql}), 0), coalesce(sum(${coverage.excluded.sql}), 0) FROM ${from} AND ${filters.sql}`
			: null;
		let total = 0;
		let incomplete = 0;
		let excluded = 0;
		const started = performance.now();
		let first = false;
		let reported = started;
		const report = () => {
			if (!options.onProgress || !total) return;
			const now = performance.now();
			const groupsSoFar = () => Number(this.#db.selectValue(`SELECT count(*) FROM ${groups}`));
			if (!first) {
				const n = groupsSoFar();
				if (n < PAGE_SIZE && now - started < PROVISIONAL_MS) return;
				first = true;
				reported = now;
				options.onProgress({ matches: total, groups: n, rows: this.#rows(session, 0) });
				return;
			}
			if (now - reported < PROGRESS_EVERY_MS) return;
			reported = now;
			options.onProgress({ matches: total, groups: groupsSoFar(), rows: null });
		};
		await this.#sliced('sources', scope, async () => {
			report();
			await checkpoint();
		}, (lo, hi) => {
			const [added, a, b] = this.#atomic(() => {
				const n = this.#exec(insertMatches, [lo, hi, ...universe.params, ...expr.params]);
				if (n) this.#exec(upsertGroups, [lo, hi]);
				if (!coverage || !coverageSql) return [n, 0, 0];
				const row = this.#db.selectArray(coverageSql, [...coverage.incomplete.params, ...coverage.excluded.params, lo, hi, ...filters.params]) as number[];
				return [n, row[0], row[1]];
			});
			total += added;
			incomplete += a;
			excluded += b;
		});
		const groupCount = Number(this.#db.selectValue(`SELECT count(*) FROM ${groups}`));
		const suggestions = total === 0 && plan.suggestible.length ? await suggest(this.#db, this.#tokenizer, plan.suggestible, checkpoint) : [];
		return {
			id,
			matches: total,
			groups: groupCount,
			pages: Math.ceil(groupCount / PAGE_SIZE),
			incomplete,
			excluded,
			suggestions,
			generation: session.generation,
			dims,
			resolved: plan.resolved
		};
	}

	async #meaning(id: number, session: Session, plan: Plan, lexicalPlan: Plan, excluded: string | null, options: MeaningOptions): Promise<MeaningSummary> {
		const signal = options.signal;
		const checkpoint = async () => {
			signal?.throwIfAborted();
			await yieldTask();
			signal?.throwIfAborted();
		};
		const sources = this.#range('sources');
		const leafTables: string[] = [];
		for (const [k, leaf] of plan.leaves.entries()) {
			const table = this.#table(session, `l${k}`, 'source INTEGER PRIMARY KEY, score REAL NOT NULL');
			leafTables.push(table);
			for (const step of leaf.steps) await this.#step(step, table, null, sources, checkpoint);
		}
		const universe = universeOf(plan);
		const expr = render(plan.expr, plan, (leaf) => leafTables[leaf]);
		const { epoch } = options.epoch;
		const matrix = await options.cache.ready(epoch, checkpoint);

		const covered: Fragment = options.epoch.current
			? { sql: 'EXISTS (SELECT 1 FROM coverage c WHERE c.source = s.id AND c.dimension = ? AND c.state = ?)', params: [Dimension.semantic, Coverage.complete] }
			: { sql: 'EXISTS (SELECT 1 FROM passages p WHERE p.epoch = ? AND p.source = s.id)', params: [epoch] };
		const size = sources[1] + 1;
		const groupOf = new Int32Array(size).fill(-1);
		const threadGroups = new Map<string, number>();
		const byThread = options.group === 'thread';
		const omitted = matrix.omitted;
		let eligible = 0;
		let incomplete = 0;
		const ids = byThread ? `group_concat(s.id || char(31) || ifnull(CASE WHEN s.kind = ${SourceKind.message} THEN s.thread_id END, ''), char(30))` : 'group_concat(s.id)';
		const outside = excluded ? ` AND NOT EXISTS (SELECT 1 FROM ${excluded}_g x WHERE x.grp = ${GROUP_KEY[options.group]})` : '';
		const select = this.#db.prepare(`SELECT ${ids}, coalesce(sum(NOT ${covered.sql}), 0) FROM sources s WHERE s.id BETWEEN ? AND ? AND ${universe.sql} AND ${expr.sql}${outside}`);
		try {
			await this.#sliced('sources', sources, checkpoint, (lo, hi) => {
				let list: string | null = null;
				let missing = 0;
				select.bind([...covered.params, lo, hi, ...universe.params, ...expr.params]);
				try {
					if (select.step()) {
						list = select.getString(0);
						missing = select.getInt(1) ?? 0;
					}
				} finally {
					select.reset(true);
				}
				incomplete += missing;
				if (!list) return;
				if (!byThread) {
					for (const id of list.split(',')) {
						groupOf[Number(id)] = Number(id);
						eligible++;
					}
					return;
				}
				for (const entry of list.split('\x1e')) {
					const cut = entry.indexOf('\x1f');
					const source = Number(entry.slice(0, cut));
					const thread = entry.slice(cut + 1);
					let group = source;
					if (thread) {
						let t = threadGroups.get(thread);
						if (t === undefined) {
							t = size + threadGroups.size;
							threadGroups.set(thread, t);
						}
						group = t;
					}
					groupOf[source] = group;
					eligible++;
				}
			});
		} finally {
			select.finalize();
		}
		let capped = 0;
		for (const source of omitted) if (source < size && groupOf[source] >= 0) capped++;
		incomplete += capped;

		const query = new Int8Array(DIMENSIONS);
		const queryScale = quantize(options.vector, query);
		const heap = new GroupHeap(CANDIDATE_GROUPS, CANDIDATE_PASSAGES);
		for (let row = 0; row < matrix.size; row += SCAN_ROWS) {
			await checkpoint();
			matrix.scan(row, row + SCAN_ROWS, query, queryScale, groupOf, (r, group, score) => heap.offer(group, score, r));
		}
		await checkpoint();

		const held = heap.groups();
		const kinds = new Map<number, number>();
		const dates = new Map<number, number>();
		const sids = new Map<number, string>();
		const threads = new Map<number, string | null>();
		const head = this.#db.prepare(`SELECT kind, date, source_id, CASE WHEN kind = ${SourceKind.message} THEN thread_id END FROM sources WHERE id = ?`);
		try {
			this.#atomic(() => {
				for (const g of held) {
					for (const item of g.items) {
						const source = matrix.sourceAt(item.item);
						if (kinds.has(source)) continue;
						try {
							head.bind([source]);
							if (!head.step()) continue;
							kinds.set(source, head.getInt(0)!);
							dates.set(source, head.getInt(1)!);
							sids.set(source, head.getString(2)!);
							threads.set(source, head.getString(3));
						} finally {
							head.reset(true);
						}
					}
				}
			});
		} finally {
			head.finalize();
		}
		const groupKeys = new Map<number, string>();
		const keyOf = (group: number, source: number) => {
			let key = groupKeys.get(group);
			if (key === undefined) {
				const thread = threads.get(source) ?? null;
				key = group >= size && thread !== null ? `t${thread}` : `${kinds.get(source)}:${sids.get(source)}`;
				groupKeys.set(group, key);
			}
			return key;
		};
		const exact = new Map<number, number>();
		const wanted: number[] = [];
		for (const g of held.slice(0, RESCORE_GROUPS)) {
			for (const item of g.items) if (item.score >= g.score - RESCORE_MARGIN) wanted.push(item.item);
		}
		wanted.sort((a, b) => matrix.sourceAt(a) - matrix.sourceAt(b) || matrix.ordinalAt(a) - matrix.ordinalAt(b));
		const read = this.#db.prepare('SELECT vector FROM passages WHERE epoch = ? AND source = ? AND ordinal = ?');
		try {
			for (let i = 0; i < wanted.length; i += RESCORE_BATCH) {
				await checkpoint();
				this.#atomic(() => {
					for (const row of wanted.slice(i, i + RESCORE_BATCH)) {
						let vector: Float32Array | null = null;
						try {
							read.bind([epoch, matrix.sourceAt(row), matrix.ordinalAt(row)]);
							if (read.step()) vector = decoded(read.get(0) as Uint8Array);
						} finally {
							read.reset(true);
						}
						if (vector) exact.set(row, significant(dot(vector, options.vector)));
					}
				});
			}
		} finally {
			read.finalize();
		}

		const rank = (a: Rescored, b: Rescored) => {
			const x = sids.get(a.source)!;
			const y = sids.get(b.source)!;
			return b.score - a.score || dates.get(b.source)! - dates.get(a.source)! || kinds.get(a.source)! - kinds.get(b.source)! || (x < y ? -1 : x > y ? 1 : 0);
		};
		const finals: Rescored[] = [];
		const memberScores = new Map<number, number>();
		for (const [i, g] of held.entries()) {
			let best: Rescored | null = null;
			for (const item of g.items) {
				const source = matrix.sourceAt(item.item);
				if (groupOf[source] !== g.group || !kinds.has(source)) continue;
				const score = i < RESCORE_GROUPS ? exact.get(item.item) : significant(item.score);
				if (score === undefined) continue;
				memberScores.set(source, Math.max(memberScores.get(source) ?? -Infinity, score));
				const scored: Rescored = { group: g.group, source, ordinal: matrix.ordinalAt(item.item), score };
				if (!best || rank(scored, best) < 0) best = scored;
			}
			if (best) finals.push(best);
		}
		finals.sort(rank);
		finals.length = Math.min(finals.length, MEANING_GROUPS);

		const words: Session = { prefix: `${session.prefix}w`, sort: 'relevance', group: options.group, tables: [], invalid: false, summary: null, highlights: [], generation: session.generation };
		const order = orderBy('relevance');
		const fused = await (async () => {
			try {
				await this.#execute(id, words, lexicalPlan, { sort: 'relevance', group: options.group, signal });
				await checkpoint();
				const notExcluded = excluded ? `WHERE grp NOT IN (SELECT grp FROM ${excluded}_g)` : '';
				const lexical: Ranked[] = (
					this.#db.selectArrays(`SELECT grp, date, tier FROM ${words.prefix}_g ${notExcluded} ORDER BY ${order} LIMIT ?`, [MEANING_GROUPS]) as [string, number, number][]
				).map(([key, date, tier]) => ({ key, date, tier }));
				const semantic: Ranked[] = finals.map((f) => ({ key: keyOf(f.group, f.source), date: dates.get(f.source)!, tier: 0 }));
				const result = fuse(lexical, semantic, MEANING_GROUPS);
				const best = new Map(finals.map((f) => [keyOf(f.group, f.source), f]));
				const matches = this.#table(session, 'm', 'source INTEGER PRIMARY KEY, grp TEXT NOT NULL, thread TEXT, tier INTEGER NOT NULL, score REAL NOT NULL, date INTEGER NOT NULL, kind INTEGER NOT NULL, sid TEXT NOT NULL', [`grp, ${order}`]);
				const groups = this.#table(session, 'g', 'grp TEXT PRIMARY KEY, thread TEXT, n INTEGER NOT NULL, tier INTEGER NOT NULL, score REAL NOT NULL, date INTEGER NOT NULL, kind INTEGER NOT NULL, sid TEXT NOT NULL', [order]);
				this.#atomic(() => {
					const insertMember = this.#db.prepare(`INSERT OR IGNORE INTO ${matches} (source, grp, thread, tier, score, date, kind, sid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
					const insertGroup = this.#db.prepare(`INSERT INTO ${groups} (grp, thread, n, tier, score, date, kind, sid) VALUES (?, ?, 0, ?, ?, ?, ?, ?)`);
					const copyGroup = this.#db.prepare(`INSERT INTO ${groups} (grp, thread, n, tier, score, date, kind, sid) SELECT grp, thread, 0, ?, ?, date, kind, sid FROM ${words.prefix}_g WHERE grp = ?`);
					const copyMembers = this.#db.prepare(`INSERT OR IGNORE INTO ${matches} (source, grp, thread, tier, score, date, kind, sid) SELECT source, grp, thread, tier, score, date, kind, sid FROM ${words.prefix}_m WHERE grp = ?`);
					try {
						const kept = new Map(result.map((f) => [f.key, f]));
						for (const [source, score] of memberScores) {
							const key = keyOf(groupOf[source], source);
							const f = kept.get(key);
							if (!f || f.semantic === null) continue;
							insertMember.bind([source, key, threads.get(source) ?? null, f.tier, score, dates.get(source)!, kinds.get(source)!, sids.get(source)!]).stepReset();
						}
						for (const f of result) {
							session.channels!.set(f.key, f.channel);
							if (f.lexical !== null) copyMembers.bind([f.key]).stepReset();
							const top = best.get(f.key);
							if (f.semantic !== null && top) {
								insertGroup.bind([f.key, threads.get(top.source) ?? null, f.tier, f.score, dates.get(top.source)!, kinds.get(top.source)!, sids.get(top.source)!]).stepReset();
								session.passages!.set(f.key, { epoch, source: top.source, ordinal: top.ordinal });
							} else {
								copyGroup.bind([f.tier, f.score, f.key]).stepReset();
							}
						}
					} finally {
						insertMember.finalize();
						insertGroup.finalize();
						copyGroup.finalize();
						copyMembers.finalize();
					}
					this.#db.exec(`UPDATE ${groups} SET n = (SELECT count(*) FROM ${matches} m WHERE m.grp = ${groups}.grp)`);
				});
				return result;
			} finally {
				this.#drop(words);
			}
		})();
		return {
			id,
			groups: fused.length,
			pages: Math.ceil(fused.length / PAGE_SIZE),
			eligible,
			incomplete,
			capped,
			scanned: matrix.live,
			rebuilding: options.epoch.rebuilding,
			generation: session.generation,
			resolved: plan.resolved
		};
	}

	async #step(step: Step, table: string, candidates: string | null, scope: readonly [number, number], checkpoint: () => Promise<void>): Promise<void> {
		switch (step.kind) {
			case 'fts': {
				const content = step.table === 'parts_fts' ? 'parts' : 'literals';
				const near = step.near ? this.#overlap(step.near) : null;
				const joined = step.role !== null || step.verify !== null || near !== null;
				const restrict = candidates ? ` AND f.rowid IN (SELECT id FROM ${content} WHERE source IN (SELECT source FROM ${candidates}))` : '';
				const sql = `SELECT f.source, f.field, -bm25(${step.table})${joined ? ', p.locator, p.text' : ''}
					FROM ${step.table} f${joined ? ' JOIN parts p ON p.id = f.rowid' : ''} WHERE ${step.table} MATCH ?${restrict}`;
				const fields = new Set<number>(step.fields);
				const scores = new Map<number, number>();
				await this.#stream(sql, [step.match], checkpoint, (row) => {
					const field = row[1] as Field;
					if (!fields.has(field)) return;
					if (step.role !== null && row[3] !== step.role) return;
					if (step.verify !== null && !bounded(row[4] as string, step.verify)) return;
					if (near && !nearWithin(this.#tokenizer.tokens(row[4] as string), near.left, near.right, near.distance)) return;
					const source = row[0] as number;
					scores.set(source, (scores.get(source) ?? 0) + (row[2] as number) * WEIGHTS[field]);
				});
				await this.#fill(table, scores, checkpoint);
				return;
			}
			case 'msgid': {
				const sliceOn = candidates ? 's.id IN (SELECT source FROM ' + candidates + ' WHERE source BETWEEN ? AND ?)' : 'f.rowid BETWEEN ? AND ?';
				const sql = `INSERT INTO ${table} (source, score)
					SELECT DISTINCT s.id, 0 FROM literals_fts f JOIN sources s ON s.id = f.source
					WHERE literals_fts MATCH ? AND f.field = ? AND tl_bounded(s.message_id, ?) AND ${sliceOn}
					ON CONFLICT (source) DO NOTHING`;
				const range = candidates ? scope : this.#range('literals');
				await this.#sliced('literals', range, checkpoint, (lo, hi) => this.#exec(sql, [step.match, Field.identifier, step.needle, lo, hi]));
				return;
			}
			case 'scan': {
				const sliceOn = candidates ? `p.source IN (SELECT source FROM ${candidates} WHERE source BETWEEN ? AND ?)` : 'p.id BETWEEN ? AND ?';
				const sql = `INSERT INTO ${table} (source, score)
					SELECT DISTINCT p.source, 0 FROM parts p
					WHERE p.field IN (${placeholders(step.fields.length)}) AND instr(tl_fold(p.text), ?) > 0 AND ${sliceOn}
					ON CONFLICT (source) DO NOTHING`;
				const range = candidates ? scope : this.#range('parts');
				await this.#sliced('parts', range, checkpoint, (lo, hi) => this.#exec(sql, [...step.fields, step.needle, lo, hi]));
				return;
			}
		}
	}

	async #stream(sql: string, params: readonly BindValue[], checkpoint: () => Promise<void>, onRow: (row: SqlValue[]) => void): Promise<void> {
		const statement = this.#db.prepare(sql);
		try {
			statement.bind(params as BindValue[]);
			for (let more = true; more; ) {
				await checkpoint();
				const until = performance.now() + TARGET_MS;
				for (let n = 0; ; n++) {
					more = statement.step();
					if (!more) break;
					onRow(statement.get([]));
					if ((n & 255) === 255 && performance.now() > until) break;
				}
			}
		} finally {
			statement.finalize();
		}
	}

	async #fill(table: string, scores: Map<number, number>, checkpoint: () => Promise<void>): Promise<void> {
		const entries = [...scores];
		const insert = this.#db.prepare(`INSERT INTO ${table} (source, score) VALUES (?, ?) ON CONFLICT (source) DO UPDATE SET score = score + excluded.score`);
		try {
			for (let i = 0; i < entries.length; i += FILL_BATCH) {
				await checkpoint();
				this.#atomic(() => {
					for (const entry of entries.slice(i, i + FILL_BATCH)) insert.bind(entry).stepReset();
				});
			}
		} finally {
			insert.finalize();
		}
	}

	#overlap(near: { left: string; right: string; distance: number }): { left: string[]; right: string[]; distance: number } | null {
		const left = this.#tokenizer.tokens(near.left);
		const right = this.#tokenizer.tokens(near.right);
		if (!left.some((t) => right.includes(t))) return null;
		return { left, right, distance: near.distance };
	}
}
