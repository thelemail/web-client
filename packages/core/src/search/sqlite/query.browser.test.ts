import { afterEach, describe, expect, it } from 'vitest';
import { parseQuery } from '../query';
import type { QueryContext } from './compile';
import { Harness, SNAPSHOT, collect, document } from './harness';
import { referenceSearch } from './reference';
import type { PageResult, QueryOutcome } from './run';
import { Coverage, Dimension, Field, Flag, Role, SourceKind, type SearchDocument } from './types';

const live: Harness[] = [];

afterEach(() => {
	for (const h of live.splice(0)) h.terminate();
});

const CTX: QueryContext = {
	identities: ['ada@calloway.test', 'ada.old@calloway.test'],
	folders: [
		{ id: 'f-projects', path: 'Projects' },
		{ id: 'f-invoices', path: 'Projects/Invoices' },
		{ id: 'f-personal', path: 'Personal' }
	],
	labels: [
		{ id: 'l-tax', name: 'Tax 2026' },
		{ id: 'l-travel', name: 'Travel' }
	],
	attachmentText: true
};

const RELEVANCE = { sort: 'relevance', group: 'message' } as const;
const ALL = Flag.read | Flag.starred | Flag.inbox | Flag.archive | Flag.sent | Flag.spam | Flag.trash | Flag.snoozed;

async function memory(docs: SearchDocument[]): Promise<Harness> {
	const h = new Harness();
	live.push(h);
	await h.call({ op: 'memory' });
	await h.call({ op: 'putBatch', docs });
	return h;
}

async function ids(h: Harness, input: string, ctx: QueryContext = CTX): Promise<string[]> {
	const { groups } = await collect(h, input, ctx, RELEVANCE);
	return groups.map((g) => g.best.sourceId);
}

function message(sourceId: string, overrides: Partial<SearchDocument>): SearchDocument {
	return document(sourceId, { knownFlags: ALL, ...overrides });
}

describe('words examples', () => {
	const docs = [
		message('agreement', {
			date: Date.UTC(2026, 2, 4),
			participants: [{ role: Role.from, name: 'Alice', address: 'alice@example.com' }],
			parts: [{ field: Field.body, text: 'Attached is the service agreement for review.' }]
		}),
		message('agreement-old', {
			date: Date.UTC(2025, 11, 30),
			participants: [{ role: Role.from, name: 'Alice', address: 'alice@example.com' }],
			parts: [{ field: Field.body, text: 'Draft of the service agreement.' }]
		}),
		message('agreement-trash', {
			date: Date.UTC(2026, 3, 1),
			flags: Flag.trash,
			participants: [{ role: Role.from, name: 'Alice', address: 'alice@example.com' }],
			parts: [{ field: Field.body, text: 'Old service agreement.' }]
		}),
		message('agreement-split', {
			date: Date.UTC(2026, 3, 2),
			participants: [{ role: Role.from, name: 'Alice', address: 'alice@example.com' }],
			parts: [{ field: Field.body, text: 'The service was fine; the agreement follows.' }]
		}),
		message('tax-pdf', {
			collections: [{ id: 'l-tax', type: 'label' }],
			parts: [{ field: Field.body, text: 'Statement attached.' }],
			attachments: [{ attachmentId: 'a1', filename: 'statement-2026.pdf', mime: 'application/pdf', size: 1000 }],
			flags: Flag.inbox | Flag.attachments
		}),
		message('tax-inline', {
			collections: [{ id: 'l-tax', type: 'label' }],
			attachments: [{ attachmentId: 'a1', filename: 'logo.pdf', mime: 'application/pdf', size: 10, inline: true }]
		}),
		message('untagged-pdf', {
			attachments: [{ attachmentId: 'a1', filename: 'report.pdf', mime: 'application/pdf', size: 1000 }]
		}),
		message('invoice', { subject: 'Your invoice', participants: [{ role: Role.from, name: 'Shop', address: 'shop@example.com' }] }),
		message('receipt-news', {
			subject: 'Receipt inside',
			participants: [{ role: Role.from, name: 'News', address: 'newsletter@example.com' }]
		}),
		message('body-invoice', { subject: 'Hello', parts: [{ field: Field.body, text: 'invoice in the body only' }] }),
		message('ident', { parts: [{ field: Field.body, text: 'Case AB-19/007 is closed.' }] }),
		message('ident-longer', { parts: [{ field: Field.body, text: 'Case AB-19/0071 is open.' }] }),
		message('ident-split', { parts: [{ field: Field.body, text: 'AB 19 007 appears spaced out.' }] }),
		message('unread-spam', { flags: Flag.spam }),
		message('unread-trash', { flags: Flag.trash }),
		message('read-inbox', { flags: Flag.inbox | Flag.read }),
		message('unread-inbox', { flags: Flag.inbox }),
		document('draft-to-me', {
			kind: SourceKind.draft,
			flags: 0,
			knownFlags: 0,
			participants: [{ role: Role.to, name: 'Ada', address: 'Ada@Calloway.test' }]
		}),
		document('draft-to-other', {
			kind: SourceKind.draft,
			flags: 0,
			knownFlags: 0,
			participants: [{ role: Role.to, name: 'Bram', address: 'bram@calloway.test' }]
		}),
		message('message-to-me', { participants: [{ role: Role.to, name: 'Ada', address: 'ada@calloway.test' }] })
	];

	it('finds a full phrase from a sender after a date outside trash', async () => {
		const h = await memory(docs);
		expect(await ids(h, 'from:alice@example.com after:2026-01-01 "service agreement" -in:trash')).toEqual(['agreement']);
	});

	it('finds labelled pdf attachments by filename without the word in the body', async () => {
		const h = await memory(docs);
		expect(await ids(h, 'filename:pdf has:attachment label:"Tax 2026"')).toEqual(['tax-pdf']);
	});

	it('applies boolean precedence and an exact sender exclusion', async () => {
		const h = await memory(docs);
		expect((await ids(h, 'subject:(invoice OR receipt) -from:newsletter@example.com')).sort()).toEqual(['invoice']);
	});

	it('matches a punctuation-bearing identifier exactly', async () => {
		const h = await memory(docs);
		const { groups } = await collect(h, '+AB-19/007', CTX, RELEVANCE);
		expect(groups.map((g) => [g.best.sourceId, g.exact])).toEqual([['ident', true]]);
	});

	it('widens to spam and trash for in:anywhere', async () => {
		const h = await memory(docs);
		const found = await ids(h, 'in:anywhere is:unread');
		expect(found).toEqual(expect.arrayContaining(['unread-spam', 'unread-trash', 'unread-inbox']));
		expect(found).not.toContain('read-inbox');
		expect(found).not.toContain('draft-to-me');
	});

	it('finds drafts addressed to the account', async () => {
		const h = await memory(docs);
		expect(await ids(h, 'in:drafts to:me')).toEqual(['draft-to-me']);
	});

	it('agrees with the reference on every example', async () => {
		const h = await memory(docs);
		for (const input of [
			'from:alice@example.com after:2026-01-01 "service agreement" -in:trash',
			'filename:pdf has:attachment label:"Tax 2026"',
			'subject:(invoice OR receipt) -from:newsletter@example.com',
			'+AB-19/007',
			'in:anywhere is:unread',
			'in:drafts to:me'
		]) {
			const parsed = parseQuery(input, SNAPSHOT);
			if (!parsed.ok) throw new Error(input);
			const got = await collect(h, input, CTX, RELEVANCE);
			const want = referenceSearch(docs, parsed.query, CTX, RELEVANCE);
			expect(got.groups, input).toEqual(want.groups);
			expect(got.summary.matches, input).toBe(want.matches);
		}
	});
});

describe('retrieval', () => {
	it('intersects terms across fields of one message', async () => {
		const h = await memory([
			message('both', {
				parts: [
					{ field: Field.body, text: 'Hotel booking confirmed.' },
					{ field: Field.attachmentText, attachmentId: 'a1', locator: 1, text: 'Invoice total 120' }
				]
			}),
			message('body-only', { parts: [{ field: Field.body, text: 'Hotel booking confirmed.' }] })
		]);
		expect(await ids(h, 'hotel invoice')).toEqual(['both']);
		expect(await ids(h, 'hotel invoice', { ...CTX, attachmentText: false })).toEqual([]);
		expect(await ids(h, '"hotel invoice"')).toEqual([]);
	});

	it('requires distinct occurrences for a repeated proximity term', async () => {
		const h = await memory([
			message('twice', { parts: [{ field: Field.body, text: 'alpha beta alpha' }] }),
			message('once', { parts: [{ field: Field.body, text: 'alpha beta gamma' }] }),
			message('overlap', { parts: [{ field: Field.body, text: 'red green blue' }] })
		]);
		expect(await ids(h, 'alpha AROUND 2 alpha')).toEqual(['twice']);
		expect(await ids(h, '"red green" AROUND 0 "green blue"')).toEqual([]);
		expect(await ids(h, 'red AROUND 0 green')).toEqual(['overlap']);
	});

	it('never counts an unindexed body as a negated match', async () => {
		const h = await memory([
			message('indexed', { parts: [{ field: Field.body, text: 'nothing here' }] }),
			message('pending', { parts: [], coverage: { [Dimension.metadata]: Coverage.complete, [Dimension.body]: Coverage.pending } }),
			message('secret', { parts: [{ field: Field.body, text: 'the secret plan' }] })
		]);
		const { summary, groups } = await collect(h, '-body:secret', CTX, RELEVANCE);
		expect(groups.map((g) => g.best.sourceId)).toEqual(['indexed']);
		expect(summary.incomplete).toBe(1);
	});

	it('treats drafts as known unread-absent', async () => {
		const h = await memory([
			document('draft', { kind: SourceKind.draft, flags: 0, knownFlags: 0 }),
			message('read', { flags: Flag.inbox | Flag.read }),
			message('unknown', { flags: Flag.inbox, knownFlags: Flag.inbox })
		]);
		expect((await ids(h, '-is:read')).sort()).toEqual(['draft']);
		expect(await ids(h, 'is:unread')).toEqual([]);
		expect(await ids(h, 'is:read')).toEqual(['read']);
	});

	it('finds unsegmented scripts by substring, including two characters', async () => {
		const h = await memory([
			message('tokyo', { parts: [{ field: Field.body, text: '明日は東京タワーに行きます' }] }),
			message('kyoto', { parts: [{ field: Field.body, text: '京都で会いましょう' }] })
		]);
		expect(await ids(h, '東京')).toEqual(['tokyo']);
		expect(await ids(h, '東京タワー')).toEqual(['tokyo']);
		expect((await ids(h, '京')).sort()).toEqual(['kyoto', 'tokyo']);
	});

	it('finds a message by its Message-ID as an identifier', async () => {
		const h = await memory([message('m1', { messageId: '<X7.Q@mail.calloway.test>' }), message('m2', {})]);
		const { groups } = await collect(h, 'x7.q@mail.calloway.test', CTX, RELEVANCE);
		expect(groups.map((g) => [g.best.sourceId, g.exact])).toEqual([['m1', true]]);
		expect(await ids(h, 'rfc822msgid:X7.Q@mail.calloway.test')).toEqual(['m1']);
	});

	it('resolves folders with descendants and reports unknown names', async () => {
		const h = await memory([
			message('top', { collections: [{ id: 'f-projects', type: 'folder' }] }),
			message('child', { collections: [{ id: 'f-invoices', type: 'folder' }] }),
			message('other', { collections: [{ id: 'f-personal', type: 'folder' }] })
		]);
		expect((await ids(h, 'in:projects')).sort()).toEqual(['child', 'top']);
		expect(await ids(h, 'in:"Projects/Invoices"')).toEqual(['child']);
		const parsed = parseQuery('label:Missing', SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		const outcome = await h.call<QueryOutcome>({ op: 'query', token: 1, query: parsed.query, ctx: CTX, options: RELEVANCE });
		expect(outcome).toEqual({ ok: false, error: { code: 'unknown_label', range: { start: 0, end: 13 }, name: 'Missing' } });
	});

	it('supports delivered-to, list and inline-aware attachment filters', async () => {
		const h = await memory([
			message('list', { listId: '<Updates.Calloway.test>' }),
			message('delivered', { participants: [{ role: Role.deliveredTo, name: '', address: 'alias@calloway.test' }] }),
			message('inline', { attachments: [{ attachmentId: 'a', filename: 'logo.png', mime: 'image/png', size: 1, inline: true }] })
		]);
		expect(await ids(h, 'list:updates.calloway.test')).toEqual(['list']);
		expect(await ids(h, 'deliveredto:alias@calloway.test')).toEqual(['delivered']);
		expect(await ids(h, 'alias')).toEqual([]);
		expect(await ids(h, 'has:image')).toEqual(['inline']);
		expect(await ids(h, 'has:attachment')).toEqual([]);
	});
});

describe('ranking and pages', () => {
	it('ranks the exact identifier tier first, then score, then date and id', async () => {
		const h = await memory([
			message('subject-hit', { subject: 'renewal renewal', parts: [], date: 1 }),
			message('body-hit', { subject: 'x', parts: [{ field: Field.body, text: 'renewal' }], date: 2 }),
			message('quoted-hit', { subject: 'x', parts: [{ field: Field.quoted, text: 'renewal' }], date: 3 }),
			message('tie-b', { subject: 'x', parts: [{ field: Field.body, text: 'renewal' }], date: 2 })
		]);
		expect(await ids(h, 'renewal')).toEqual(['subject-hit', 'body-hit', 'tie-b', 'quoted-hit']);
		const newest = await collect(h, 'renewal', CTX, { sort: 'newest', group: 'message' });
		expect(newest.groups.map((g) => g.best.sourceId)).toEqual(['quoted-hit', 'body-hit', 'tie-b', 'subject-hit']);
	});

	it('groups by thread before paging and counts every match', async () => {
		const docs = Array.from({ length: 130 }, (_, i) =>
			message(`m${String(i).padStart(3, '0')}`, {
				threadId: `t${i % 60}`,
				date: 1_000 + i,
				parts: [{ field: Field.body, text: 'budget forecast' }]
			})
		);
		const h = await memory(docs);
		const { summary, groups } = await collect(h, 'budget', CTX, { sort: 'newest', group: 'thread' });
		expect(summary).toMatchObject({ matches: 130, groups: 60, pages: 2 });
		expect(groups).toHaveLength(60);
		expect(new Set(groups.map((g) => g.key)).size).toBe(60);
		expect(groups.reduce((n, g) => n + g.matches, 0)).toBe(130);
		expect(groups[0]).toMatchObject({ threadId: 't9', matches: 3, best: { sourceId: 'm129' } });
		expect(groups[0].sources.map((s) => s.sourceId)).toEqual(['m129', 'm069', 'm009']);
		const parsed = parseQuery('budget', SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		expect(groups).toEqual(referenceSearch(docs, parsed.query, CTX, { sort: 'newest', group: 'thread' }).groups);
	});

	it('invalidates an open query when a matched source is deleted', async () => {
		const h = await memory([message('a', {}), message('b', {})]);
		const parsed = parseQuery('subject', SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		const outcome = await h.call<QueryOutcome>({ op: 'query', token: 1, query: parsed.query, ctx: CTX, options: RELEVANCE });
		if (!outcome.ok) throw new Error('query');
		expect(await h.call<PageResult>({ op: 'page', session: outcome.summary.id, index: 0 })).toMatchObject({ ok: true });
		await h.call({ op: 'delete', key: { kind: SourceKind.message, sourceId: 'zzz' } });
		expect(await h.call<PageResult>({ op: 'page', session: outcome.summary.id, index: 0 })).toMatchObject({ ok: true });
		await h.call({ op: 'delete', key: { kind: SourceKind.message, sourceId: 'a' } });
		expect(await h.call<PageResult>({ op: 'page', session: outcome.summary.id, index: 0 })).toEqual({ ok: false, reason: 'invalidated' });
		await h.call({ op: 'closeQuery', session: outcome.summary.id });
		expect(await h.call<PageResult>({ op: 'page', session: outcome.summary.id, index: 0 })).toEqual({ ok: false, reason: 'closed' });
		expect(await h.select("SELECT count(*) FROM temp.sqlite_schema WHERE name LIKE 'q%'")).toEqual([[0]]);
	});
});

describe('suggestions', () => {
	it('suggests close vocabulary only when nothing matches and never applies it', async () => {
		const h = await memory([
			message('a', { parts: [{ field: Field.body, text: 'invoice invoice receipt' }] }),
			message('b', { parts: [{ field: Field.body, text: 'invoices voice' }] }),
			message('c', { parts: [{ field: Field.body, text: 'reconciliation' }] })
		]);
		const missing = await collect(h, 'invoce', CTX, RELEVANCE);
		expect(missing.summary.matches).toBe(0);
		expect(missing.summary.suggestions).toEqual([{ range: { start: 0, end: 6 }, original: 'invoce', replacement: 'invoice' }]);
		const long = await collect(h, 'reconcilaton', CTX, RELEVANCE);
		expect(long.summary.suggestions.map((s) => s.replacement)).toEqual(['reconciliation']);
		expect((await collect(h, 'invoice', CTX, RELEVANCE)).summary.suggestions).toEqual([]);
		expect((await collect(h, 'inv', CTX, RELEVANCE)).summary.suggestions).toEqual([]);
		expect((await collect(h, '"invoce"', CTX, RELEVANCE)).summary.suggestions).toEqual([]);
	});
});

describe('hostile input', () => {
	const hostile = [
		'"a"" OR ""b"',
		'NEAR(a b)',
		'body: x',
		'{body}:secret',
		'parts_fts:secret',
		"'); DROP TABLE sources;--",
		'x) OR 1=1 --',
		'^start',
		'"*"',
		'col:val*',
		'"NEAR(\\"a\\" \\"b\\", 0)"',
		'+"); DELETE FROM parts; --"'
	];

	it('treats query syntax from the user as text', async () => {
		const h = await memory([
			message('m1', { parts: [{ field: Field.body, text: 'secret NEAR a b start x val' }] }),
			message('m2', { parts: [{ field: Field.body, text: 'drop table sources delete from parts' }] })
		]);
		for (const input of hostile) {
			const parsed = parseQuery(input, SNAPSHOT);
			if (!parsed.ok) continue;
			const got = await collect(h, input, CTX, RELEVANCE);
			const want = referenceSearch(
				[
					message('m1', { parts: [{ field: Field.body, text: 'secret NEAR a b start x val' }] }),
					message('m2', { parts: [{ field: Field.body, text: 'drop table sources delete from parts' }] })
				],
				parsed.query,
				CTX,
				RELEVANCE
			);
			expect(got.groups, input).toEqual(want.groups);
		}
		expect(await h.select('SELECT count(*) FROM sources')).toEqual([[2]]);
		expect(await h.select('SELECT count(*) FROM parts')).toEqual([[8]]);
	});
});
