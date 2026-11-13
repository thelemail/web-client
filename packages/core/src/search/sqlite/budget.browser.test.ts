import { afterAll, expect, it } from 'vitest';
import { parseQuery } from '../query';
import type { QueryContext } from './compile';
import { Harness, SNAPSHOT, document, randomDirectory, randomKey, removeDirectory } from './harness';
import { PAGE_SIZE, type PageResult, type QueryOutcome } from './run';
import { Field, Role } from './types';

const SOURCES = 100_000;
const BATCH = 250;
const BUDGET = 96 * 1024 * 1024;
const WORDS = 'meeting invoice quarterly review contract renewal shipment delivery schedule budget forecast payroll travel hotel flight agenda minutes draft proposal estimate receipt'.split(' ');

const dir = randomDirectory();
const h = new Harness();
let indexed = false;

afterAll(async () => {
	h.terminate();
	await removeDirectory(dir);
});

function body(seed: number): string {
	const out: string[] = [];
	let x = seed;
	for (let i = 0; i < 90; i++) {
		x = (x * 1103515245 + 12345) & 0x7fffffff;
		out.push(WORDS[x % WORDS.length]);
	}
	return `${out.join(' ')} ref INV-${seed % 9000}/${seed % 97}.`;
}

function synthetic(i: number) {
	return document(`s${i}`, {
		date: 1_700_000_000_000 + i * 60_000,
		subject: `Re: ${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]} #${i}`,
		participants: [
			{ role: Role.from, name: `Sender ${i % 500}`, address: `sender${i % 500}@calloway.test` },
			{ role: Role.to, name: 'Ada Calloway', address: 'ada@calloway.test' }
		],
		attachments: i % 10 === 0 ? [{ attachmentId: `a${i}`, filename: `scan-${i}.pdf`, mime: 'application/pdf', size: 40_000 }] : [],
		parts: [
			{ field: Field.body, text: body(i) },
			{ field: Field.quoted, text: body(i + 1).slice(0, 200) }
		]
	});
}

it(
	'indexes 100k synthetic sources within the worker memory budget',
	async (ctx) => {
		if (!(await h.call<boolean>({ op: 'opfs' }))) ctx.skip();
		const opened = await h.call({ op: 'open', directory: dir, file: '/index.db', key: randomKey(), rebuild: false });
		expect(opened).toEqual({ ok: true, rebuilt: false });
		const started = performance.now();
		let slowest = 0;
		for (let start = 0; start < SOURCES; start += BATCH) {
			const docs = Array.from({ length: BATCH }, (_, j) => synthetic(start + j));
			const t = performance.now();
			await h.call({ op: 'putBatch', docs });
			slowest = Math.max(slowest, performance.now() - t);
		}
		const elapsed = performance.now() - started;
		await h.call({ op: 'maintain', step: 'merge' });
		const stats = await h.call<{ heap: number }>({ op: 'stats' });
		const [[count]] = await h.select<[number]>('SELECT count(*) FROM sources');
		const [[pages, pageSize]] = await h.select<[number, number]>('SELECT page_count, page_size FROM pragma_page_count, pragma_page_size');
		const hits = await h.select<[number]>("SELECT count(*) FROM parts_fts WHERE parts_fts MATCH '\"quarterly review\"'");
		await ctx.annotate(
			JSON.stringify({
				sources: count,
				seconds: Math.round(elapsed / 100) / 10,
				slowestBatchMs: Math.round(slowest),
				wasmHeapMiB: Math.round((stats.heap / 1048576) * 10) / 10,
				fileMiB: Math.round(((pages * pageSize) / 1048576) * 10) / 10,
				phraseHits: hits[0][0]
			})
		);
		expect(count).toBe(SOURCES);
		expect(stats.heap).toBeLessThanOrEqual(BUDGET);
		expect(await h.call({ op: 'integrity' })).toBe(true);
		indexed = true;
	},
	30 * 60_000
);

const CTX: QueryContext = { identities: ['ada@calloway.test'], folders: [], labels: [], attachmentText: true };
const BARE = '(1, 2, 3, 4, 5, 6)';

async function start(input: string, token: number): Promise<QueryOutcome | { cancelled: true }> {
	const parsed = parseQuery(input, SNAPSHOT);
	if (!parsed.ok) throw new Error(input);
	return h.call({ op: 'query', token, query: parsed.query, ctx: CTX, options: { sort: 'relevance', group: 'thread' } });
}

it.for([
	{
		name: 'broad OR',
		input: 'meeting OR quarterly OR receipt',
		cancel: 100,
		truth: `SELECT count(DISTINCT source) FROM parts_fts WHERE parts_fts MATCH 'meeting OR quarterly OR receipt' AND field IN ${BARE}`
	},
	{
		name: 'negative-only',
		input: '-subject:hotel',
		cancel: 100,
		truth: `SELECT count(*) FROM sources WHERE id NOT IN (SELECT source FROM parts_fts WHERE parts_fts MATCH 'hotel' AND field = 1)`
	},
	{
		name: 'prefix',
		input: 're*',
		cancel: 250,
		truth: `SELECT count(DISTINCT source) FROM parts_fts WHERE parts_fts MATCH 're*' AND field IN ${BARE}`
	}
])(
	'answers a $name query on 100k sources with an exact count, every page and fast cancellation',
	{ timeout: 30 * 60_000 },
	async ({ input, truth, cancel }, ctx) => {
		if (!indexed) ctx.skip();
		const [[expected]] = await h.select<[number]>(truth);
		const started = performance.now();
		const outcome = await start(input, 1);
		const completed = performance.now() - started;
		if (!('ok' in outcome) || !outcome.ok) throw new Error('query');
		const { summary } = outcome;
		expect(summary.matches).toBe(expected);
		expect(summary.groups).toBe(expected);
		const first = await h.call<PageResult>({ op: 'page', session: summary.id, index: 0 });
		const firstPage = performance.now() - started;
		if (!first.ok) throw new Error('page');
		expect(first.groups).toHaveLength(Math.min(PAGE_SIZE, expected));
		let seen = 0;
		const keys = new Set<string>();
		for (let i = 0; i < summary.pages; i++) {
			const page = await h.call<PageResult>({ op: 'page', session: summary.id, index: i });
			if (!page.ok) throw new Error(`page ${i}`);
			for (const g of page.groups) {
				keys.add(g.key);
				seen += g.matches;
			}
		}
		expect(seen).toBe(expected);
		expect(keys.size).toBe(summary.groups);
		await h.call({ op: 'closeQuery', session: summary.id });

		const cancellations: number[] = [];
		for (const delay of [5, 40, 120, Math.max(1, Math.floor(completed * 0.6))]) {
			const token = 10 + cancellations.length;
			const running = start(input, token);
			await new Promise((resolve) => setTimeout(resolve, delay));
			const sent = performance.now();
			await h.call({ op: 'cancel', token });
			const result = await running;
			const waited = performance.now() - sent;
			if ('cancelled' in result) cancellations.push(waited);
			else if (result.ok) await h.call({ op: 'closeQuery', session: result.summary.id });
		}
		const [[leftover]] = await h.select<[number]>("SELECT count(*) FROM temp.sqlite_schema WHERE name GLOB 'q[0-9]*'");
		await ctx.annotate(
			JSON.stringify({
				query: input,
				matches: summary.matches,
				completeMs: Math.round(completed),
				firstPageMs: Math.round(firstPage),
				cancelMs: cancellations.map(Math.round)
			})
		);
		expect(cancellations.length).toBeGreaterThan(0);
		expect(Math.max(...cancellations)).toBeLessThan(cancel);
		expect(leftover).toBe(0);
	}
);
