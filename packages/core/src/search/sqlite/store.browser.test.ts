import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Harness, document, randomDirectory, randomKey, removeDirectory } from './harness';
import { ANALYZER_VERSION } from './analysis';
import { SCHEMA_VERSION } from './schema';
import { Coverage, Dimension, Field, Flag, SourceKind } from './types';

const live: Harness[] = [];
const dirs: string[] = [];
let opfs = false;

function harness(): Harness {
	const h = new Harness();
	live.push(h);
	return h;
}

function directory(): string {
	const d = randomDirectory();
	dirs.push(d);
	return d;
}

beforeAll(async () => {
	const h = new Harness();
	opfs = await h.call<boolean>({ op: 'opfs' });
	h.terminate();
});

afterEach(async () => {
	for (const h of live.splice(0)) h.terminate();
	for (const d of dirs.splice(0)) await removeDirectory(d);
});

async function memory(): Promise<Harness> {
	const h = harness();
	await h.call({ op: 'memory' });
	return h;
}

async function matches(h: Harness, table: 'parts_fts' | 'literals_fts', query: string): Promise<string[]> {
	const rows = await h.select<[string]>(
		`SELECT DISTINCT s.source_id FROM ${table} f JOIN sources s ON s.id = f.source WHERE ${table} MATCH ? ORDER BY 1`,
		[query]
	);
	return rows.map((r) => r[0]);
}

async function ftsRows(h: Harness): Promise<{ parts: number; partsFts: number; literals: number; literalsFts: number }> {
	const [[parts]] = await h.select<[number]>('SELECT count(*) FROM parts');
	const [[partsFts]] = await h.select<[number]>('SELECT count(*) FROM parts_fts');
	const [[literals]] = await h.select<[number]>('SELECT count(*) FROM literals');
	const [[literalsFts]] = await h.select<[number]>('SELECT count(*) FROM literals_fts');
	return { parts, partsFts, literals, literalsFts };
}

describe('lexical model', () => {
	it('matches a phrase within one part and never across parts, attachments or pages', async () => {
		const h = await memory();
		await h.call({
			op: 'put',
			doc: document('m1', {
				subject: 'Quarterly planning',
				parts: [
					{ field: Field.body, text: 'Please send the quarterly report before Friday.' },
					{ field: Field.attachmentText, attachmentId: 'a1', locator: 1, text: 'Totals for the quarterly' },
					{ field: Field.attachmentText, attachmentId: 'a1', locator: 2, text: 'review meeting notes' },
					{ field: Field.attachmentText, attachmentId: 'a2', locator: 1, text: 'annual summary' },
					{ field: Field.attachmentText, attachmentId: 'a3', locator: 1, text: 'audit findings' }
				]
			})
		});
		expect(await matches(h, 'parts_fts', '"quarterly report"')).toEqual(['m1']);
		expect(await matches(h, 'parts_fts', '"quarterly review"')).toEqual([]);
		expect(await matches(h, 'parts_fts', '"summary audit"')).toEqual([]);
		expect(await matches(h, 'parts_fts', '"planning please"')).toEqual([]);
		expect(await matches(h, 'parts_fts', 'quarterly AND review')).toEqual([]);
		const [[source, field]] = await h.select<[string, number]>(
			"SELECT p.attachment_id, p.locator FROM parts_fts f JOIN parts p ON p.id = f.rowid WHERE parts_fts MATCH '\"meeting notes\"'"
		);
		expect([source, field]).toEqual(['a1', 2]);
	});

	it('folds diacritics and case for words', async () => {
		const h = await memory();
		await h.call({ op: 'put', doc: document('m1', { parts: [{ field: Field.body, text: 'Crème BRÛLÉE at the Café' }] }) });
		expect(await matches(h, 'parts_fts', '"creme brulee"')).toEqual(['m1']);
		expect(await matches(h, 'parts_fts', 'cafe')).toEqual(['m1']);
	});

	it('finds identifiers, addresses, filenames and unsegmented scripts by substring', async () => {
		const h = await memory();
		await h.call({
			op: 'put',
			doc: document('m1', {
				participants: [{ role: 1, name: 'Zebulon Marsh', address: 'Zebulon.Marsh+billing@calloway.test' }],
				attachments: [{ attachmentId: 'a1', filename: 'Statement-2026-10.pdf', mime: 'application/pdf', size: 1 }],
				parts: [{ field: Field.body, text: 'Invoice INV-2026/0007 for 東京都の事務所 is attached. Order 7f3c9e2a-1b4d-4e8f-9a0b-c1d2e3f4a5b6.' }]
			})
		});
		expect(await matches(h, 'literals_fts', '"2026/00"')).toEqual(['m1']);
		expect(await matches(h, 'literals_fts', '"inv-2026/0007"')).toEqual(['m1']);
		expect(await matches(h, 'literals_fts', '"marsh+billing"')).toEqual(['m1']);
		expect(await matches(h, 'literals_fts', '"京都の"')).toEqual(['m1']);
		expect(await matches(h, 'literals_fts', '"statement-2026"')).toEqual(['m1']);
		expect(await matches(h, 'literals_fts', '".pdf"')).toEqual(['m1']);
		expect(await matches(h, 'literals_fts', '"1b4d-4e8f"')).toEqual(['m1']);
		expect(await matches(h, 'literals_fts', '"<m1@calloway.test>"')).toEqual(['m1']);
		const [[address, domain]] = await h.select<[string, string]>('SELECT address, domain FROM participants');
		expect([address, domain]).toEqual(['zebulon.marsh+billing@calloway.test', 'calloway.test']);
	});

	it('replaces by revision and leaves no stale rows', async () => {
		const h = await memory();
		expect(await h.call({ op: 'put', doc: document('m1', { parts: [{ field: Field.body, text: 'obsolete wording REF-1/77' }] }) })).toBe('inserted');
		const before = await ftsRows(h);
		expect(
			await h.call({
				op: 'put',
				doc: document('m1', { contentRevision: 2, parts: [{ field: Field.body, text: 'fresh wording REF-2/88' }] })
			})
		).toBe('replaced');
		expect(await matches(h, 'parts_fts', 'obsolete')).toEqual([]);
		expect(await matches(h, 'literals_fts', '"ref-1/77"')).toEqual([]);
		expect(await matches(h, 'parts_fts', 'fresh')).toEqual(['m1']);
		expect(await ftsRows(h)).toEqual(before);
		expect(await h.call({ op: 'put', doc: document('m1', { parts: [{ field: Field.body, text: 'obsolete wording' }] }) })).toBe('stale');
		expect(await h.call({ op: 'put', doc: document('m1', { contentRevision: 2 }) })).toBe('unchanged');
		expect(await h.call({ op: 'integrity' })).toBe(true);
		const ids = await h.select<[number]>('SELECT id FROM parts ORDER BY id');
		const ftsIds = await h.select<[number]>('SELECT rowid FROM parts_fts ORDER BY rowid');
		expect(ftsIds).toEqual(ids);
	});

	it('updates metadata without touching the index', async () => {
		const h = await memory();
		await h.call({ op: 'put', doc: document('m1', { collections: [{ id: 'f1', type: 'folder' }] }) });
		const before = await ftsRows(h);
		const meta = {
			metadataRevision: 2,
			threadId: 'thread-m1',
			date: 1_760_000_000_000,
			flags: Flag.read | Flag.starred | Flag.archive,
			knownFlags: Flag.read | Flag.starred | Flag.inbox,
			collections: [{ id: 'l1', type: 'label' as const }]
		};
		expect(await h.call({ op: 'updateMetadata', key: { kind: SourceKind.message, sourceId: 'm1' }, meta })).toBe('metadata');
		expect(await h.call({ op: 'updateMetadata', key: { kind: SourceKind.message, sourceId: 'm1' }, meta })).toBe('unchanged');
		expect(await ftsRows(h)).toEqual(before);
		expect(await h.select('SELECT flags, metadata_rev FROM sources')).toEqual([[Flag.read | Flag.starred | Flag.archive, 2]]);
		expect(await h.select('SELECT collection_id, type FROM collections')).toEqual([['l1', 2]]);
		expect(
			await h.call({ op: 'setCoverage', key: { kind: SourceKind.message, sourceId: 'm1' }, dimension: Dimension.attachmentText, state: Coverage.failed })
		).toBe(true);
		expect(await h.select('SELECT dimension, state FROM coverage ORDER BY 1')).toEqual([
			[Dimension.metadata, Coverage.complete],
			[Dimension.body, Coverage.complete],
			[Dimension.attachmentText, Coverage.failed]
		]);
	});

	it('deletes a source with every derived row', async () => {
		const h = await memory();
		await h.call({ op: 'put', doc: document('m1', { collections: [{ id: 'f1', type: 'folder' }] }) });
		await h.call({ op: 'put', doc: document('m2') });
		expect(await h.call({ op: 'delete', key: { kind: SourceKind.message, sourceId: 'm1' } })).toBe(true);
		expect(await h.call({ op: 'delete', key: { kind: SourceKind.message, sourceId: 'm1' } })).toBe(false);
		expect(await matches(h, 'parts_fts', 'body')).toEqual(['m2']);
		for (const table of ['participants', 'collections', 'attachments', 'coverage']) {
			const [[n]] = await h.select<[number]>(`SELECT count(*) FROM ${table} WHERE source NOT IN (SELECT id FROM sources)`);
			expect(n).toBe(0);
		}
		const rows = await ftsRows(h);
		expect(rows.partsFts).toBe(rows.parts);
		expect(rows.literalsFts).toBe(rows.literals);
		expect(await h.call({ op: 'integrity' })).toBe(true);
	});

	it('keeps drafts apart from messages with the same id', async () => {
		const h = await memory();
		await h.call({ op: 'put', doc: document('x1') });
		await h.call({ op: 'put', doc: document('x1', { kind: SourceKind.draft, flags: 0, knownFlags: 0 }) });
		expect(await h.select('SELECT kind, known_flags FROM sources ORDER BY kind')).toEqual([
			[SourceKind.message, Flag.read | Flag.starred | Flag.inbox],
			[SourceKind.draft, 0]
		]);
	});

	it('runs merge and optimize as maintenance', async () => {
		const h = await memory();
		for (let i = 0; i < 40; i++) await h.call({ op: 'put', doc: document(`m${i}`) });
		await h.call({ op: 'maintain', step: 'merge' });
		await h.call({ op: 'maintain', step: 'optimize' });
		expect(await h.call({ op: 'integrity' })).toBe(true);
		expect((await matches(h, 'parts_fts', 'body')).length).toBe(40);
	});
});

describe('encrypted file', () => {
	it('stores no readable term, address or subject', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const h = harness();
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key: randomKey(), rebuild: false })).toEqual({ ok: true, rebuilt: false });
		const docs = Array.from({ length: 60 }, (_, i) =>
			document(`m${i}`, {
				subject: `Hollowbrook lease renewal ${i}`,
				participants: [{ role: 1, name: 'Zebulon Marsh', address: 'zebulon.marsh@calloway.test' }],
				parts: [{ field: Field.body, text: `The xylophonist will review INV-2026/0007 on Thursday ${i}.` }]
			})
		);
		await h.call({ op: 'putBatch', docs });
		const result = await h.call<{ bytes: number; found: string[] }>({
			op: 'scan',
			directory: dir,
			needles: ['Hollowbrook', 'hollowbrook', 'xylophonist', 'zebulon', 'calloway.test', 'INV-2026', 'Thursday', 'parts_fts', 'sources', 'SQLite format 3']
		});
		expect(result.bytes).toBeGreaterThan(16_384);
		expect(result.found).toEqual([]);
	});

	it('fails cleanly with a wrong key and keeps the file', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const a = harness();
		await a.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false });
		await a.call({ op: 'put', doc: document('m1') });
		await a.call({ op: 'close' });
		a.terminate();

		const b = harness();
		expect(await b.call({ op: 'open', directory: dir, file: '/index.db', key: randomKey(), rebuild: false })).toEqual({ ok: false, code: 'unreadable' });
		expect(await b.call({ op: 'open', directory: dir, file: '/index.db', key: new Uint8Array(16), rebuild: true })).toEqual({ ok: false, code: 'bad-key' });
		expect(await b.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false })).toEqual({ ok: true, rebuilt: false });
		expect(await b.select('SELECT source_id FROM sources')).toEqual([['m1']]);
	});

	it('rebuilds an unknown schema version instead of reading it', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const h = harness();
		await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false });
		await h.call({ op: 'put', doc: document('m1') });
		await h.call({ op: 'exec', sql: "UPDATE meta SET value = 99 WHERE key = 'schema_version'" });
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false })).toEqual({ ok: false, code: 'unreadable' });
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: true })).toEqual({ ok: true, rebuilt: true });
		expect(await h.select('SELECT count(*) FROM sources')).toEqual([[0]]);
		expect(await h.select("SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([[SCHEMA_VERSION]]);
	});

	it('upgrades a version 1 database in place', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const h = harness();
		await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false });
		await h.call({ op: 'put', doc: document('m1') });
		await h.call({
			op: 'exec',
			sql: `DROP INDEX sources_list;
				ALTER TABLE sources DROP COLUMN list_id;
				ALTER TABLE attachments DROP COLUMN inline;
				UPDATE meta SET value = 1 WHERE key = 'schema_version'`
		});
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false })).toEqual({ ok: true, rebuilt: false });
		expect(await h.select("SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([[SCHEMA_VERSION]]);
		expect(await h.select('SELECT source_id, list_id FROM sources')).toEqual([['m1', null]]);
		await h.call({
			op: 'put',
			doc: document('m2', {
				listId: '<News.Calloway.test>',
				attachments: [{ attachmentId: 'a1', filename: 'logo.png', mime: 'image/png', size: 10, inline: true }]
			})
		});
		expect(await h.select("SELECT list_id FROM sources WHERE source_id = 'm2'")).toEqual([['news.calloway.test']]);
		expect(await h.select('SELECT inline FROM attachments')).toEqual([[1]]);
	});

	it('rebuilds a foreign database', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const h = harness();
		await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false });
		await h.call({ op: 'exec', sql: 'DROP TABLE meta' });
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: true })).toEqual({ ok: true, rebuilt: true });
		expect(await h.select("SELECT count(*) FROM sqlite_schema WHERE name = 'meta'")).toEqual([[1]]);
	});

	it('rebuilds a corrupt file instead of reading it as empty', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const h = harness();
		await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false });
		await h.call({ op: 'putBatch', docs: Array.from({ length: 80 }, (_, i) => document(`m${i}`)) });
		await h.call({ op: 'corrupt', directory: dir });
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false })).toEqual({ ok: false, code: 'unreadable' });
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: true })).toEqual({ ok: true, rebuilt: true });
		expect(await h.select('SELECT count(*) FROM sources')).toEqual([[0]]);
	});

	it('creates and migrates a fresh database', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const h = harness();
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false })).toEqual({ ok: true, rebuilt: false });
		expect(await h.select("SELECT key, value FROM meta ORDER BY key")).toEqual([
			['analyzer_version', ANALYZER_VERSION],
			['schema_version', SCHEMA_VERSION]
		]);
		await h.call({ op: 'close' });
		expect(await h.call({ op: 'drop', directory: dir, file: '/index.db' })).toBe(true);
	});
});
