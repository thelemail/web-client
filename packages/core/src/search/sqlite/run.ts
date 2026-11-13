import type { BindValue, CApi, Database, SqlValue } from '@thelemail/sqlite-wasm';
import type { ParsedQuery, QueryError } from '../query/ast';
import { SQLITE_INTERRUPT, resultCode } from './capi';
import {
	WEIGHTS,
	compile,
	coverageFragments,
	render,
	universeOf,
	usedDimensions,
	type Fragment,
	type Grouping,
	type Plan,
	type QueryContext,
	type Sort,
	type Step
} from './compile';
import { registerFunctions } from './functions';
import { suggest, type Suggestion } from './suggest';
import { Tokenizer, nearWithin } from './tokenizer';
import { Field, SourceKind, type SourceKey } from './types';

export const PAGE_SIZE = 50;
export const SELECTIVE = 2000;
const TARGET_MS = 12;
const STATEMENT_MS = 40;
const PROGRESS_OPS = 1000;
const FIRST_SLICE = 2048;
const MAX_SLICE = 1 << 20;

export interface QueryOptions {
	sort: Sort;
	group: Grouping;
	signal?: AbortSignal;
	strategy?: 'auto' | 'scan' | 'candidates';
}

export interface QuerySummary {
	id: number;
	matches: number;
	groups: number;
	pages: number;
	incomplete: number;
	excluded: number;
	suggestions: Suggestion[];
}

export type QueryOutcome = { ok: true; summary: QuerySummary } | { ok: false; error: QueryError };

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

export type PageResult = { ok: true; groups: ResultGroup[] } | { ok: false; reason: 'invalidated' | 'closed' };

interface Session {
	prefix: string;
	sort: Sort;
	tables: string[];
	invalid: boolean;
	summary: QuerySummary | null;
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

const WEIGHT_CASE = `CASE f.field ${Object.entries(WEIGHTS)
	.map(([field, weight]) => `WHEN ${Number(field)} THEN ${weight}`)
	.join(' ')} END`;

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

function yieldTask(): Promise<void> {
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
		const session: Session = { prefix: `temp.q${id}`, sort: options.sort, tables: [], invalid: false, summary: null };
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

	page(id: number, index: number): PageResult {
		const session = this.#sessions.get(id);
		if (!session?.summary) return { ok: false, reason: 'closed' };
		if (session.invalid) return { ok: false, reason: 'invalidated' };
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
		return {
			ok: true,
			groups: rows.map(([grp, thread, n, tier, score, date, kind, sid]) => ({
				key: grp as string,
				threadId: thread as string | null,
				matches: n as number,
				exact: tier === 1,
				score: score as number,
				date: date as number,
				best: { kind: kind as SourceKind, sourceId: sid as string },
				sources: members.get(grp as string) ?? []
			}))
		};
	}

	close(id: number): void {
		const session = this.#sessions.get(id);
		if (!session) return;
		this.#sessions.delete(id);
		this.#drop(session);
	}

	invalidate(source: number): void {
		for (const session of this.#sessions.values()) {
			if (session.invalid || !session.tables.includes(`${session.prefix}_m`)) continue;
			if (this.#db.selectValue(`SELECT 1 FROM ${session.prefix}_m WHERE source = ?`, [source])) session.invalid = true;
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
			const outcome = this.#guarded(() => run(a, b), size > 1);
			if (!outcome.ok) {
				size = Math.max(1, size >> 1);
				continue;
			}
			const took = performance.now() - started;
			if (took < TARGET_MS / 2) size = Math.min(MAX_SLICE, size * 2);
			else if (took > TARGET_MS * 2) size = Math.max(1, size >> 1);
			a = b + 1;
		}
		this.#slices.set(kind, size);
	}

	#range(table: string): [number, number] {
		const row = this.#db.selectArray(`SELECT min(rowid), max(rowid) FROM ${table}`) as SqlValue[];
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
		const tier = exact.length ? `(${exact.map((k) => `s.id IN (SELECT source FROM ${table(k)})`).join(' OR ')})` : '0';
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
		await this.#sliced('sources', scope, checkpoint, (lo, hi) => {
			const [added, a, b] = this.#db.transaction(() => {
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
			suggestions
		};
	}

	async #step(step: Step, table: string, candidates: string | null, scope: readonly [number, number], checkpoint: () => Promise<void>): Promise<void> {
		switch (step.kind) {
			case 'fts': {
				const content = step.table === 'parts_fts' ? 'parts' : 'literals';
				const near = step.near ? this.#overlap(step.near) : null;
				const joins: string[] = [];
				const where: string[] = [`${step.table} MATCH ?`, `f.field IN (${placeholders(step.fields.length)})`];
				const params: BindValue[] = [step.match, ...step.fields];
				if (step.role !== null || step.verify !== null || near) joins.push('JOIN parts p ON p.id = f.rowid');
				if (step.role !== null) {
					where.push('p.locator = ?');
					params.push(step.role);
				}
				if (step.verify !== null) {
					where.push('tl_bounded(p.text, ?)');
					params.push(step.verify);
				}
				const sliceOn = candidates
					? `f.rowid IN (SELECT id FROM ${content} WHERE source IN (SELECT source FROM ${candidates} WHERE source BETWEEN ? AND ?))`
					: 'f.rowid BETWEEN ? AND ?';
				where.push(sliceOn);
				const select = `SELECT f.source AS source, -bm25(${step.table}) * ${WEIGHT_CASE} AS score${near ? ', p.text AS text' : ''}
					FROM ${step.table} f ${joins.join(' ')} WHERE ${where.join(' AND ')}`;
				const range = candidates ? scope : this.#range(content);
				if (near) {
					const upsert = `INSERT INTO ${table} (source, score) VALUES (?, ?) ON CONFLICT (source) DO UPDATE SET score = score + excluded.score`;
					await this.#sliced(content, range, checkpoint, (lo, hi) => {
						const rows = this.#db.selectArrays(select, [...params, lo, hi]);
						const kept = rows.filter(([, , text]) => nearWithin(this.#tokenizer.tokens(text as string), near.left, near.right, near.distance));
						this.#db.transaction(() => {
							for (const [source, score] of kept) this.#exec(upsert, [source, score]);
						});
					});
					return;
				}
				const sql = `WITH r AS MATERIALIZED (${select})
					INSERT INTO ${table} (source, score) SELECT source, sum(score) FROM r WHERE 1 GROUP BY source
					ON CONFLICT (source) DO UPDATE SET score = score + excluded.score`;
				await this.#sliced(content, range, checkpoint, (lo, hi) => this.#exec(sql, [...params, lo, hi]));
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

	#overlap(near: { left: string; right: string; distance: number }): { left: string[]; right: string[]; distance: number } | null {
		const left = this.#tokenizer.tokens(near.left);
		const right = this.#tokenizer.tokens(near.right);
		if (!left.some((t) => right.includes(t))) return null;
		return { left, right, distance: near.distance };
	}
}
