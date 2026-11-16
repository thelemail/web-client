import { afterEach, describe, expect, it } from 'vitest';
import { parseQuery } from '../query';
import type { QueryContext } from './compile';
import { Harness, SNAPSHOT, collect, document } from './harness';
import { HISTORY_LIMIT, HISTORY_MAX_AGE_MS } from './history';
import type { Completions, Provisional, QueryOutcome } from './run';
import { Field, Flag, Role, type SearchDocument } from './types';

const live: Harness[] = [];

afterEach(() => {
	for (const h of live.splice(0)) h.terminate();
});

const CTX: QueryContext = { identities: ['ada@calloway.test'], folders: [], labels: [], attachmentText: true };
const NEWEST = { sort: 'newest', group: 'thread' } as const;

async function memory(docs: SearchDocument[]): Promise<Harness> {
	const h = new Harness();
	live.push(h);
	await h.call({ op: 'memory' });
	await h.call({ op: 'putBatch', docs });
	return h;
}

function parsed(input: string) {
	const p = parseQuery(input, SNAPSHOT);
	if (!p.ok) throw new Error(`parse ${input}`);
	return p.query;
}

describe('result rows', () => {
	it('carries subject, sender, recipients, flags and a highlighted excerpt from the local index', async () => {
		const h = await memory([
			document('m1', {
				subject: 'Hotel invoice for March',
				flags: Flag.inbox | Flag.read,
				participants: [
					{ role: Role.from, name: 'Alice Doe', address: 'alice@example.com' },
					{ role: Role.to, name: 'Ada Calloway', address: 'ada@calloway.test' }
				],
				parts: [{ field: Field.body, text: 'Please find the hotel invoice attached. Thanks!' }]
			})
		]);
		const { rows } = await collect(h, 'hotel invoice', CTX, NEWEST);
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row.subject).toBe('Hotel invoice for March');
		expect(row.subjectSpans.map((s) => row.subject!.slice(s.start, s.end))).toEqual(['Hotel', 'invoice']);
		expect(row.from).toEqual({ name: 'Alice Doe', address: 'alice@example.com' });
		expect(row.to).toEqual([{ name: 'Ada Calloway', address: 'ada@calloway.test' }]);
		expect(row.flags & Flag.read).toBe(Flag.read);
		expect(row.fields).toEqual([Field.subject, Field.body]);
		expect(row.excerpt?.spans.map((s) => row.excerpt!.text.slice(s.start, s.end))).toEqual(['hotel', 'invoice']);
	});

	it('names the attachment and page an excerpt came from', async () => {
		const h = await memory([
			document('m1', {
				attachments: [{ attachmentId: 'a1', filename: 'Q3 forecast.pdf', mime: 'application/pdf', size: 10 }],
				parts: [
					{ field: Field.body, text: 'see attached' },
					{ field: Field.attachmentText, text: 'the revenue forecast for Q3', attachmentId: 'a1', locator: 4 }
				]
			})
		]);
		const { rows } = await collect(h, 'revenue', CTX, NEWEST);
		expect(rows[0]).toMatchObject({ filename: 'Q3 forecast.pdf', attachments: 1, excerpt: { field: Field.attachmentText, locator: 4 } });
	});

	it('pins the generation a query ran against', async () => {
		const h = await memory([document('m1')]);
		await h.call({ op: 'generation', value: 7 });
		const { summary } = await collect(h, 'subject', CTX, NEWEST);
		expect(summary.generation).toBe(7);
		expect(summary.dims).toEqual([1, 2, 3, 4]);
	});

	it('reports a provisional first page before the final count on a large result', async () => {
		const docs = Array.from({ length: 2600 }, (_, i) =>
			document(`m${String(i).padStart(4, '0')}`, { threadId: `t${i}`, date: 1_000 + i, parts: [{ field: Field.body, text: 'budget forecast' }] })
		);
		const h = await memory(docs);
		const { outcome, events } = await h.call<{ outcome: QueryOutcome; events: Provisional[] }>({ op: 'progress', query: parsed('budget'), ctx: CTX, options: NEWEST });
		if (!outcome.ok) throw new Error('query');
		const first = events.find((e) => e.rows);
		expect(first).toBeDefined();
		expect(first!.rows!.length).toBeGreaterThan(0);
		expect(first!.matches).toBeLessThanOrEqual(outcome.summary.matches);
		expect(outcome.summary.matches).toBe(2600);
	});
});

describe('completions', () => {
	it('completes words from the local vocabulary and people from participants', async () => {
		const h = await memory([
			document('m1', {
				participants: [{ role: Role.from, name: 'Inês Moreira', address: 'ines@example.com' }],
				parts: [{ field: Field.body, text: 'invoice invoices invitation' }]
			}),
			document('m2', { parts: [{ field: Field.body, text: 'invoice again' }] })
		]);
		const words = await h.call<Completions>({ op: 'complete', prefix: 'inv' });
		expect(words.terms[0]).toBe('invoice');
		expect(words.terms).toEqual(expect.arrayContaining(['invoices', 'invitation']));
		const people = await h.call<Completions>({ op: 'complete', prefix: 'ines' });
		expect(people.people).toEqual([{ name: 'Inês Moreira', address: 'ines@example.com' }]);
		const byName = await h.call<Completions>({ op: 'complete', prefix: 'moreira' });
		expect(byName.people.map((p) => p.address)).toEqual(['ines@example.com']);
		expect((await h.call<Completions>({ op: 'complete', prefix: 'i' })).terms).toEqual([]);
	});
});

describe('history', () => {
	async function withHistory(): Promise<Harness> {
		const h = await memory([]);
		await h.call({ op: 'historyKey', key: crypto.getRandomValues(new Uint8Array(32)) });
		return h;
	}

	it('stores queries sealed, newest first, without repeats', async () => {
		const h = await withHistory();
		const now = Date.UTC(2026, 10, 16);
		await h.call({ op: 'historyAdd', query: 'canary-hotel-7731', now });
		await h.call({ op: 'historyAdd', query: 'from:alice', now: now + 1 });
		await h.call({ op: 'historyAdd', query: 'canary-hotel-7731', now: now + 2 });
		expect(await h.call({ op: 'historyList', now: now + 3 })).toEqual(['canary-hotel-7731', 'from:alice']);
		const raw = await h.select('SELECT sealed FROM history');
		const bytes = raw.map((r) => new TextDecoder().decode(r[0] as Uint8Array)).join('');
		expect(bytes).not.toContain('canary');
	});

	it('keeps at most thirty queries for thirty days', async () => {
		const h = await withHistory();
		const now = Date.UTC(2026, 10, 16);
		for (let i = 0; i < HISTORY_LIMIT + 5; i++) await h.call({ op: 'historyAdd', query: `q${i}`, now: now + i });
		const list = await h.call<string[]>({ op: 'historyList', now: now + 100 });
		expect(list).toHaveLength(HISTORY_LIMIT);
		expect(list[0]).toBe(`q${HISTORY_LIMIT + 4}`);
		expect(await h.call({ op: 'historyList', now: now + HISTORY_MAX_AGE_MS + 100 })).toEqual([]);
	});

	it('clears every entry', async () => {
		const h = await withHistory();
		await h.call({ op: 'historyAdd', query: 'x', now: 1 });
		await h.call({ op: 'historyClear' });
		expect(await h.select('SELECT count(*) FROM history')).toEqual([[0]]);
	});
});
