import { afterAll, expect, it } from 'vitest';
import { Harness, document, randomDirectory, randomKey, removeDirectory } from './harness';
import { Field, Role } from './types';

const SOURCES = 100_000;
const BATCH = 250;
const BUDGET = 96 * 1024 * 1024;
const WORDS = 'meeting invoice quarterly review contract renewal shipment delivery schedule budget forecast payroll travel hotel flight agenda minutes draft proposal estimate receipt'.split(' ');

const dir = randomDirectory();
const h = new Harness();

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
	},
	30 * 60_000
);
