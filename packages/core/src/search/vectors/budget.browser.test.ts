import { afterAll, expect, it } from 'vitest';
import { parseQuery } from '../query';
import type { QueryContext } from '../sqlite/compile';
import { Harness, SNAPSHOT, randomDirectory, randomKey, removeDirectory } from '../sqlite/harness';
import type { MeaningEpoch, MeaningOutcome } from '../sqlite/run';
import { Corpus, type CorpusShape } from './corpus';

const SHAPE: CorpusShape = { seed: 21, sources: 100_000, per: 2 };
const EPOCH = 77;
const MODEL = 5;
const ACTIVE: MeaningEpoch = { epoch: EPOCH, current: true, rebuilding: false };
const QUERIES = 20;
const LIMIT_MS = 500;
const CTX: QueryContext = { identities: [], folders: [], labels: [], attachmentText: true };

const dir = randomDirectory();
const h = new Harness();

afterAll(async () => {
	h.terminate();
	await removeDirectory(dir);
});

function percentile(values: number[], p: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function timed(input: string, vector: Float32Array, group: 'thread' | 'message', token = 0): Promise<{ ms: number; outcome: MeaningOutcome | { cancelled: true } }> {
	const parsed = parseQuery(input, SNAPSHOT);
	if (!parsed.ok) throw new Error(`parse ${input}`);
	const started = performance.now();
	const outcome = await h.call<MeaningOutcome | { cancelled: true }>({ op: 'meaning', token, query: parsed.query, ctx: CTX, group, vector, epoch: ACTIVE });
	const ms = performance.now() - started;
	if ('ok' in outcome && outcome.ok) await h.call({ op: 'closeQuery', session: outcome.summary.id });
	return { ms, outcome };
}

it(
	'answers a meaning query over 200,000 passages within the budget once the matrix is built',
	async (ctx) => {
		if (!(await h.call<boolean>({ op: 'opfs' }))) ctx.skip();
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key: randomKey(), rebuild: false })).toEqual({ ok: true, rebuilt: false });
		const corpus = new Corpus(SHAPE);
		const loading = performance.now();
		expect(await h.call({ op: 'synthetic', shape: SHAPE, epoch: EPOCH, model: MODEL })).toBe(200_000);
		const loadMs = performance.now() - loading;

		const first = await timed('refund', corpus.query(0), 'thread');
		expect('ok' in first.outcome && first.outcome.ok).toBe(true);
		const stats = await h.call<{ bytes: number; live: number; size: number }>({ op: 'vectorStats' });
		const heap = await h.call<{ heap: number }>({ op: 'stats' });

		const thread: number[] = [];
		const message: number[] = [];
		const filtered: number[] = [];
		for (let k = 1; k <= QUERIES; k++) {
			thread.push((await timed('refund', corpus.query(k), 'thread')).ms);
			message.push((await timed('refund', corpus.query(k), 'message')).ms);
			filtered.push((await timed('after:2023-12-20 refund', corpus.query(k), 'thread')).ms);
		}

		const parsed = parseQuery('refund', SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		const started = performance.now();
		const pending = h.call<{ cancelled?: boolean }>({ op: 'meaning', token: 9, query: parsed.query, ctx: CTX, group: 'thread', vector: corpus.query(3), epoch: ACTIVE });
		await new Promise((resolve) => setTimeout(resolve, 20));
		await h.call({ op: 'cancel', token: 9 });
		const cancelled = await pending;
		const cancelMs = performance.now() - started;

		const round = (n: number) => Math.round(n);
		await ctx.annotate(
			JSON.stringify({
				passages: stats.live,
				loadSeconds: Math.round(loadMs / 100) / 10,
				firstQueryWithBuildMs: round(first.ms),
				threadMs: { p50: round(percentile(thread, 50)), p95: round(percentile(thread, 95)) },
				messageMs: { p50: round(percentile(message, 50)), p95: round(percentile(message, 95)) },
				filteredMs: { p50: round(percentile(filtered, 50)), p95: round(percentile(filtered, 95)) },
				matrixMiB: Math.round((stats.bytes / 1048576) * 10) / 10,
				wasmHeapMiB: Math.round((heap.heap / 1048576) * 10) / 10,
				cancelMs: round(cancelMs)
			})
		);
		expect(stats.live).toBe(200_000);
		expect(percentile(thread, 95)).toBeLessThan(LIMIT_MS);
		expect(percentile(message, 95)).toBeLessThan(LIMIT_MS);
		expect(percentile(filtered, 95)).toBeLessThan(LIMIT_MS);
		expect(cancelled).toEqual({ cancelled: true });
	},
	30 * 60_000
);
