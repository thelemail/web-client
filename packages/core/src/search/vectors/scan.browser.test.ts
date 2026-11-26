import { afterEach, describe, expect, it } from 'vitest';
import { parseQuery } from '../query';
import type { EmbeddedPassage } from '../model/protocol';
import type { QueryContext } from '../sqlite/compile';
import { Harness, SNAPSHOT, document } from '../sqlite/harness';
import type { MeaningEpoch, MeaningOutcome, PageResult, QueryOutcome, ResultRow } from '../sqlite/run';
import { Coverage, Dimension, Field, Flag, Role, SourceKind, type SearchDocument } from '../sqlite/types';
import { Corpus, type CorpusShape } from './corpus';

const EPOCH = 4242;
const MODEL = 9;
const ACTIVE: MeaningEpoch = { epoch: EPOCH, current: true, rebuilding: false };
const ALL = Flag.read | Flag.starred | Flag.inbox | Flag.archive | Flag.sent | Flag.spam | Flag.trash | Flag.snoozed;

const CTX: QueryContext = {
	identities: ['ada@calloway.test'],
	folders: [],
	labels: [{ id: 'l-personal', name: 'Personal' }],
	attachmentText: true
};

const live: Harness[] = [];

afterEach(() => {
	for (const h of live.splice(0)) h.terminate();
});

async function harness(): Promise<Harness> {
	const h = new Harness();
	live.push(h);
	await h.call({ op: 'memory' });
	return h;
}

interface Answer {
	outcome: Extract<MeaningOutcome, { ok: true }>;
	rows: ResultRow[];
}

async function meaning(h: Harness, input: string, vector: Float32Array, group: 'thread' | 'message' = 'message', epoch = ACTIVE, keep = false): Promise<Answer> {
	const parsed = parseQuery(input, SNAPSHOT);
	if (!parsed.ok) throw new Error(`parse ${input}`);
	const outcome = await h.call<MeaningOutcome>({ op: 'meaning', token: 0, query: parsed.query, ctx: CTX, group, vector, epoch });
	if (!outcome.ok) throw new Error(`meaning ${input}: ${JSON.stringify(outcome)}`);
	const rows: ResultRow[] = [];
	for (let i = 0; i < outcome.summary.pages; i++) {
		const page = await h.call<PageResult>({ op: 'page', session: outcome.summary.id, index: i });
		if (!page.ok) throw new Error(`page ${i}: ${page.reason}`);
		rows.push(...page.groups);
	}
	if (!keep) await h.call({ op: 'closeQuery', session: outcome.summary.id });
	return { outcome, rows };
}

describe('meaning scan over a small mailbox', () => {
	const corpus = new Corpus({ seed: 11, sources: 0, per: 1, clusters: 4 });
	const message = (sourceId: string, overrides: Partial<SearchDocument>) =>
		document(sourceId, { knownFlags: ALL, date: Date.UTC(2026, 2, 1), parts: [{ field: Field.body, text: `A refund note from ${sourceId}.` }], ...overrides });
	const docs: SearchDocument[] = [
		message('a', { threadId: 'T1' }),
		message('b', { threadId: 'T2', participants: [{ role: Role.from, name: 'Bob', address: 'bob@elsewhere.test' }] }),
		message('c', { threadId: 'T3', collections: [{ id: 'l-personal', type: 'label' }] }),
		message('d', { threadId: 'T4', flags: Flag.spam }),
		message('e', { threadId: 'T1', date: Date.UTC(2026, 2, 5) }),
		message('f', { kind: SourceKind.draft, threadId: null }),
		message('g', { threadId: 'T5', parts: [{ field: Field.body, text: 'Ticket AB-1047 needs a refund.' }] }),
		message('h', { threadId: 'T6', date: Date.UTC(2025, 5, 1) })
	];

	async function mailbox(): Promise<Harness> {
		const h = await harness();
		await h.call({ op: 'putBatch', docs });
		await h.call({ op: 'passages', method: 'adopt', args: [EPOCH, MODEL] });
		await h.call({ op: 'passages', method: 'seed', args: [] });
		for (const [i, d] of docs.entries()) {
			const [[id, part]] = await h.select<[number, number]>(
				'SELECT s.id, p.id FROM sources s JOIN parts p ON p.source = s.id AND p.field = ? WHERE s.kind = ? AND s.source_id = ?',
				[Field.body, d.kind, d.sourceId]
			);
			const passage: EmbeddedPassage = { field: Field.body, attachmentId: null, place: null, refs: [{ part, start: 0, end: 8 }], vector: corpus.vector(i, 0) };
			expect(await h.call({ op: 'passages', method: 'put', args: [id, 1, EPOCH, [passage]] })).toBe(true);
		}
		expect(await h.call({ op: 'passages', method: 'promote', args: [] })).toBe(true);
		return h;
	}

	const q = corpus.query(1);
	const ids = (rows: ResultRow[]) => rows.map((r) => r.best.sourceId).sort();

	it('ranks every eligible message once, with spam left out', async () => {
		const h = await mailbox();
		const { rows, outcome } = await meaning(h, 'refund', q);
		expect(ids(rows)).toEqual(['a', 'b', 'c', 'e', 'f', 'g', 'h']);
		expect(outcome.summary).toMatchObject({ eligible: 7, incomplete: 0, capped: 0, scanned: 8 });
		const scores = rows.map((r) => r.score);
		expect([...scores].sort((x, y) => y - x)).toEqual(scores);
		expect(rows.find((r) => r.best.sourceId === 'a')!.passage).toEqual({ field: Field.body, attachmentId: null, place: null, text: 'A refund' });
	});

	it('groups by thread with the best member, and keeps drafts on their own', async () => {
		const h = await mailbox();
		const { rows } = await meaning(h, 'refund', q, 'thread');
		expect(rows.map((r) => r.key).sort()).toEqual(['2:f', 'tT1', 'tT2', 'tT3', 'tT5', 'tT6']);
		const t1 = rows.find((r) => r.key === 'tT1')!;
		expect(t1.sources.map((s) => s.sourceId).sort()).toEqual(['a', 'e']);
		expect(t1.matches).toBe(2);
	});

	it.each([
		['from:ada@calloway.test refund', ['a', 'c', 'e', 'f', 'g', 'h']],
		['-label:personal refund', ['a', 'b', 'e', 'f', 'g', 'h']],
		['"AB-1047" refund', ['g']],
		['after:2026-01-01 refund', ['a', 'b', 'c', 'e', 'f', 'g']],
		['in:drafts refund', ['f']],
		['in:spam refund', ['d']]
	])('applies the hard part of %s before ranking', async (input, expected) => {
		const h = await mailbox();
		expect(ids((await meaning(h, input, q)).rows)).toEqual(expected);
	});

	it('never returns a deleted message and invalidates an open result that held it', async () => {
		const h = await mailbox();
		const open = await meaning(h, 'refund', q, 'message', ACTIVE, true);
		await h.call({ op: 'delete', key: { kind: SourceKind.message, sourceId: 'b' } });
		expect(await h.call<PageResult>({ op: 'page', session: open.outcome.summary.id, index: 0 })).toEqual({ ok: false, reason: 'invalidated' });
		await h.call({ op: 'delete', key: { kind: SourceKind.message, sourceId: 'a' } });
		const after = await meaning(h, 'refund', q, 'thread');
		expect(after.rows.find((r) => r.key === 'tT1')!.best.sourceId).toBe('e');
		expect(ids(after.rows)).not.toContain('a');
		expect(ids(after.rows)).not.toContain('b');
		expect(after.outcome.summary.scanned).toBe(6);
	});

	it('picks up passages written after the matrix was built', async () => {
		const h = await mailbox();
		await meaning(h, 'refund', q);
		await h.call({ op: 'put', doc: message('late', { threadId: 'T9', parts: [{ field: Field.body, text: 'Late refund.' }] }) });
		await h.call({ op: 'passages', method: 'seed', args: [] });
		const missing = await meaning(h, 'refund', q);
		expect(missing.rows.find((r) => r.best.sourceId === 'late')?.channel).toBe('words');
		expect(missing.outcome.summary.incomplete).toBe(1);
		const [[id]] = await h.select<[number]>("SELECT id FROM sources WHERE source_id = 'late'");
		await h.call({ op: 'passages', method: 'put', args: [id, 1, EPOCH, [{ field: Field.body, attachmentId: null, place: null, refs: [], vector: q }]] });
		const found = await meaning(h, 'refund', q);
		expect(found.rows[0].best.sourceId).toBe('late');
		expect(found.outcome.summary.incomplete).toBe(0);
	});

	it('counts sources without vectors in an older epoch as not indexed', async () => {
		const h = await mailbox();
		await h.call({ op: 'put', doc: message('fresh', { threadId: 'T8' }) });
		const { outcome } = await meaning(h, 'refund', q, 'message', { epoch: EPOCH, current: false, rebuilding: false });
		expect(outcome.summary.incomplete).toBe(1);
	});

	it('leaves Words-only queries to lexical search', async () => {
		const h = await mailbox();
		const parsed = parseQuery('"AB-1047"', SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		expect(await h.call({ op: 'meaning', token: 0, query: parsed.query, ctx: CTX, group: 'message', vector: q, epoch: ACTIVE })).toEqual({ ok: false, reason: 'words' });
	});

	it('cancels with the query', async () => {
		const h = await mailbox();
		const parsed = parseQuery('refund', SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		const pending = h.call<{ cancelled?: boolean }>({ op: 'meaning', token: 7, query: parsed.query, ctx: CTX, group: 'message', vector: q, epoch: ACTIVE });
		await h.call({ op: 'cancel', token: 7 });
		expect(await pending).toEqual({ cancelled: true });
	});
});

describe('meaning scan against the fp32 reference', () => {
	const shape: CorpusShape = { seed: 3, sources: 30_000, per: 2 };
	const corpus = new Corpus(shape);
	const QUERIES = 12;

	async function recall(h: Harness, group: 'thread' | 'message', after: number | null): Promise<{ mean: number; min: number }> {
		const filter = after === null ? '' : `after:${new Date(after).toISOString().slice(0, 10)} `;
		const recalls: number[] = [];
		for (let k = 0; k < QUERIES; k++) {
			const expected = await h.call<string[]>({ op: 'reference', shape, query: k, group, after: after === null ? null : Date.parse(new Date(after).toISOString().slice(0, 10)), k: 100 });
			const { rows } = await meaning(h, `${filter}refund`, corpus.query(k), group);
			const got = new Set(rows.slice(0, 100).map((r) => r.key));
			recalls.push(expected.filter((key) => got.has(key)).length / expected.length);
		}
		return { mean: recalls.reduce((a, b) => a + b, 0) / recalls.length, min: Math.min(...recalls) };
	}

	it('matches the naive fp32 scan at Recall@100 of at least 0.99 in both views', { timeout: 600_000 }, async (ctx) => {
		const h = await harness();
		expect(await h.call({ op: 'synthetic', shape, epoch: EPOCH, model: MODEL })).toBe(60_000);
		const results: Record<string, { mean: number; min: number }> = {};
		for (const group of ['message', 'thread'] as const) {
			for (const after of [null, corpus.date(20_000)]) {
				const r = await recall(h, group, after);
				results[`${group}${after === null ? '' : ':filtered'}`] = r;
				expect(r.mean).toBeGreaterThanOrEqual(0.99);
			}
		}
		await ctx.annotate(JSON.stringify(results));
	});

	it('scans only the most recent passages over its budget and says how many it left out', { timeout: 120_000 }, async () => {
		const h = await harness();
		const small: CorpusShape = { seed: 5, sources: 2000, per: 1 };
		await h.call({ op: 'synthetic', shape: small, epoch: EPOCH, model: MODEL });
		await h.call({ op: 'vectorCache', capacity: 1000 });
		const { rows, outcome } = await meaning(h, 'refund', new Corpus(small).query(2));
		expect(outcome.summary.scanned).toBe(1000);
		expect(outcome.summary.capped).toBe(980);
		expect(outcome.summary.incomplete).toBe(980);
		expect(rows.every((r) => Number(r.best.sourceId.slice(1)) >= 1000)).toBe(true);
	});
});

describe('meaning scan coverage rows', () => {
	it('reports a source waiting for its vectors as not indexed', async () => {
		const h = await harness();
		await h.call({ op: 'put', doc: document('w', { coverage: { [Dimension.metadata]: Coverage.complete, [Dimension.body]: Coverage.complete } }) });
		await h.call({ op: 'passages', method: 'adopt', args: [EPOCH, MODEL] });
		await h.call({ op: 'passages', method: 'seed', args: [] });
		const { outcome, rows } = await meaning(h, 'refund', new Corpus({ seed: 1, sources: 0, per: 1 }).query(0), 'message', { epoch: EPOCH, current: true, rebuilding: true });
		expect(rows).toEqual([]);
		expect(outcome.summary).toMatchObject({ eligible: 1, incomplete: 1, rebuilding: true });
	});
});

describe('related results beside exact matches', () => {
	const corpus = new Corpus({ seed: 5, sources: 0, per: 1, clusters: 4 });
	const q = corpus.query(2);
	const message = (sourceId: string, threadId: string, text: string, overrides: Partial<SearchDocument> = {}) =>
		document(sourceId, { knownFlags: ALL, threadId, date: Date.UTC(2026, 2, 1), parts: [{ field: Field.body, text }], ...overrides });
	const docs: SearchDocument[] = [
		message('exact', 'R1', 'The flight refund was requested.'),
		message('sibling', 'R1', 'O voo foi cancelado.'),
		message('partial', 'R2', 'The refund is pending.'),
		message('similar', 'R3', 'O voo foi cancelado e o reembolso ainda não chegou.'),
		message('bob', 'R4', 'Flight refund from Bob.', { participants: [{ role: Role.from, name: 'Bob', address: 'bob@elsewhere.test' }] }),
		message('old', 'R5', 'An old refund.', { date: Date.UTC(2024, 0, 1) }),
		message('unembedded', 'R6', 'The flight was delayed.')
	];
	const input = 'flight refund after:2025-01-01 -from:bob@elsewhere.test';

	async function mailbox(): Promise<Harness> {
		const h = await harness();
		await h.call({ op: 'putBatch', docs });
		await h.call({ op: 'passages', method: 'adopt', args: [EPOCH, MODEL] });
		await h.call({ op: 'passages', method: 'seed', args: [] });
		for (const [i, d] of docs.entries()) {
			const [[id, part]] = await h.select<[number, number]>(
				'SELECT s.id, p.id FROM sources s JOIN parts p ON p.source = s.id AND p.field = ? WHERE s.source_id = ?',
				[Field.body, d.sourceId]
			);
			if (d.sourceId === 'unembedded') {
				expect(await h.call({ op: 'passages', method: 'mark', args: [id, 1, Coverage.failed] })).toBe(true);
				continue;
			}
			const vector = d.sourceId === 'similar' ? q : corpus.vector(i, 0);
			const passage: EmbeddedPassage = { field: Field.body, attachmentId: null, place: null, refs: [{ part, start: 0, end: 200 }], vector };
			expect(await h.call({ op: 'passages', method: 'put', args: [id, 1, EPOCH, [passage]] })).toBe(true);
		}
		expect(await h.call({ op: 'passages', method: 'promote', args: [] })).toBe(true);
		return h;
	}

	async function exact(h: Harness, group: 'thread' | 'message' = 'thread'): Promise<Extract<QueryOutcome, { ok: true }>> {
		const parsed = parseQuery(input, SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		const outcome = await h.call<QueryOutcome>({ op: 'query', token: 0, query: parsed.query, ctx: CTX, options: { sort: 'relevance', group } });
		if (!outcome.ok) throw new Error('query');
		return outcome;
	}

	async function related(h: Harness, exclude: number, group: 'thread' | 'message' = 'thread'): Promise<MeaningOutcome> {
		const parsed = parseQuery(input, SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		return h.call<MeaningOutcome>({ op: 'meaning', token: 0, query: parsed.query, ctx: CTX, group, vector: q, epoch: ACTIVE, exclude });
	}

	async function rows(h: Harness, outcome: MeaningOutcome): Promise<ResultRow[]> {
		if (!outcome.ok) throw new Error(JSON.stringify(outcome));
		const out: ResultRow[] = [];
		for (let i = 0; i < outcome.summary.pages; i++) {
			const page = await h.call<PageResult>({ op: 'page', session: outcome.summary.id, index: i });
			if (!page.ok) throw new Error(page.reason);
			out.push(...page.groups);
		}
		return out;
	}

	it('leaves out every conversation with an exact match, siblings included', async () => {
		const h = await mailbox();
		const words = await exact(h);
		expect(words.summary.matches).toBe(1);
		const list = await rows(h, await related(h, words.summary.id));
		const keys = list.map((r) => r.key);
		expect(keys).not.toContain('tR1');
		expect(list.flatMap((r) => r.sources.map((s) => s.sourceId))).not.toContain('sibling');
		expect(keys.sort()).toEqual(['tR2', 'tR3', 'tR6']);
	});

	it('labels each row by the channel that found it and shows the stored passage', async () => {
		const h = await mailbox();
		const list = await rows(h, await related(h, (await exact(h)).summary.id));
		const by = Object.fromEntries(list.map((r) => [r.key, r]));
		expect(by.tR2.channel).toBe('both');
		expect(by.tR3.channel).toBe('meaning');
		expect(by.tR6.channel).toBe('words');
		expect(by.tR3.passage?.text).toBe('O voo foi cancelado e o reembolso ainda não chegou.');
		expect(by.tR6.passage).toBeUndefined();
		expect(by.tR6.excerpt).not.toBeNull();
		expect(list[0].key).toBe('tR2');
	});

	it('never lets a hard filter through on either channel', async () => {
		const h = await mailbox();
		const list = await rows(h, await related(h, (await exact(h, 'message')).summary.id, 'message'));
		const ids = list.map((r) => r.best.sourceId);
		expect(ids).not.toContain('bob');
		expect(ids).not.toContain('old');
	});

	it('refuses an exclusion from another grouping or a closed query', async () => {
		const h = await mailbox();
		const words = await exact(h, 'message');
		expect(await related(h, words.summary.id, 'thread')).toEqual({ ok: false, reason: 'stale' });
		await h.call({ op: 'closeQuery', session: words.summary.id });
		expect(await related(h, words.summary.id, 'message')).toEqual({ ok: false, reason: 'stale' });
	});

	it('goes stale with its exact result and closes with it', async () => {
		const h = await mailbox();
		const words = await exact(h);
		const outcome = await related(h, words.summary.id);
		if (!outcome.ok) throw new Error('related');
		await h.call({ op: 'delete', key: { kind: SourceKind.message, sourceId: 'exact' } });
		expect(await h.call<PageResult>({ op: 'page', session: outcome.summary.id, index: 0 })).toEqual({ ok: false, reason: 'invalidated' });
		const again = await exact(h);
		const next = await related(h, again.summary.id);
		if (!next.ok) throw new Error('related');
		await h.call({ op: 'closeQuery', session: again.summary.id });
		expect(await h.call<PageResult>({ op: 'page', session: next.summary.id, index: 0 })).toEqual({ ok: false, reason: 'closed' });
	});
});
