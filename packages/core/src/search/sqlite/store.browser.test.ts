import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Harness, collect, document, randomDirectory, randomKey, removeDirectory } from './harness';
import type { QueryContext } from './compile';
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

const UNDO_VECTORS = `DROP TABLE vector_index;
	DROP TABLE vector_uploads;
	DROP TABLE passage_refs;
	DROP TABLE passages;
	CREATE TABLE passages (
		source INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
		ordinal INTEGER NOT NULL,
		epoch INTEGER NOT NULL,
		field INTEGER NOT NULL,
		attachment_id TEXT,
		place TEXT,
		vector BLOB NOT NULL,
		PRIMARY KEY (source, ordinal)
	) WITHOUT ROWID;
	CREATE TABLE passage_refs (
		source INTEGER NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
		ordinal INTEGER NOT NULL,
		part INTEGER NOT NULL,
		start INTEGER NOT NULL,
		end INTEGER NOT NULL,
		PRIMARY KEY (source, ordinal, part, start)
	) WITHOUT ROWID`;

const UNDO_PASSAGES = `${UNDO_VECTORS};
	DROP TABLE passage_refs;
	DROP TABLE passages`;

const UNDO_ARTIFACTS = `${UNDO_PASSAGES};
	DROP TABLE artifact_index;
	DROP INDEX source_queue_upload;
	ALTER TABLE source_queue DROP COLUMN artifact_rev;
	ALTER TABLE source_queue DROP COLUMN artifact_state;
	ALTER TABLE source_queue DROP COLUMN upload_at`;

const UNDO_ATTACHMENTS = `${UNDO_ARTIFACTS};
	DROP TABLE attachment_queue;
	DROP INDEX literals_part;
	ALTER TABLE parts DROP COLUMN place`;

const UNDO_SYNC = `${UNDO_ATTACHMENTS};
	DROP TABLE history;
	DROP TABLE source_queue;
	DROP TABLE source_collections;
	DROP TABLE source_aliases;
	ALTER TABLE sources DROP COLUMN source_rev;
	ALTER TABLE sources DROP COLUMN extraction;
	ALTER TABLE sources DROP COLUMN extractor_epoch;
	ALTER TABLE sources DROP COLUMN size_version;
	ALTER TABLE sources DROP COLUMN warnings`;

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

	it('replaces a preview with extracted text at the same revision and keeps newer metadata', async () => {
		const h = await memory();
		const preview = document('m1', {
			metadataRevision: 3,
			parts: [{ field: Field.body, text: 'snippet only' }],
			coverage: { [Dimension.metadata]: Coverage.complete, [Dimension.body]: Coverage.pending }
		});
		expect(await h.call({ op: 'put', doc: preview })).toBe('inserted');
		const meta = {
			metadataRevision: 5,
			threadId: 'thread-m1',
			date: 1_760_000_000_000,
			flags: Flag.read | Flag.archive,
			knownFlags: Flag.read | Flag.starred | Flag.inbox,
			collections: [{ id: 'l1', type: 'label' as const }]
		};
		expect(await h.call({ op: 'updateMetadata', key: { kind: SourceKind.message, sourceId: 'm1' }, meta })).toBe('metadata');
		const extracted = document('m1', {
			metadataRevision: 3,
			extraction: 1,
			parts: [{ field: Field.body, text: 'the whole harbour ledger' }]
		});
		expect(await h.call({ op: 'put', doc: extracted })).toBe('replaced');
		expect(await h.call({ op: 'put', doc: extracted })).toBe('unchanged');
		expect(await matches(h, 'parts_fts', 'snippet')).toEqual([]);
		expect(await matches(h, 'parts_fts', 'ledger')).toEqual(['m1']);
		expect(await h.select('SELECT flags, metadata_rev, extraction FROM sources')).toEqual([[Flag.read | Flag.archive, 5, 1]]);
		expect(await h.select('SELECT collection_id FROM collections')).toEqual([['l1']]);
		expect(await h.select('SELECT dimension, state FROM coverage ORDER BY 1')).toEqual([
			[Dimension.metadata, Coverage.complete],
			[Dimension.body, Coverage.complete]
		]);
	});

	it('refuses writes for a tombstoned or newer queued source', async () => {
		const h = await memory();
		await h.call({ op: 'exec', sql: "INSERT INTO source_queue (kind, source_id, source_rev, content_rev, metadata_rev, state) VALUES (1, 'gone', 9, 1, 9, 2), (1, 'newer', 7, 7, 7, 0)" });
		expect(await h.call({ op: 'put', doc: document('gone') })).toBe('stale');
		expect(await h.call({ op: 'put', doc: document('newer', { contentRevision: 6 }) })).toBe('stale');
		expect(await h.call({ op: 'put', doc: document('newer', { contentRevision: 7 }) })).toBe('inserted');
		const meta = { metadataRevision: 10, threadId: null, date: 1, flags: 0, knownFlags: 0, collections: [] };
		expect(await h.call({ op: 'updateMetadata', key: { kind: SourceKind.message, sourceId: 'gone' }, meta })).toBe('stale');
		expect(await h.select('SELECT source_id FROM sources')).toEqual([['newer']]);
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

describe('attachment text', () => {
	const ctx: QueryContext = { identities: ['ada@calloway.test'], folders: [], labels: [], attachmentText: true };
	const options = { sort: 'newest', group: 'message' } as const;
	const key = { kind: SourceKind.message, sourceId: 'm1' };

	async function queue(h: Harness, state: Coverage, rev = 1, id = 'a1'): Promise<void> {
		await h.call({
			op: 'exec',
			sql: `INSERT INTO source_queue (kind, source_id, source_rev, content_rev, metadata_rev, state, described_rev, extracted_rev) VALUES (1, 'm1', ?, ?, 1, 0, ?, ?)
				ON CONFLICT (kind, source_id) DO UPDATE SET content_rev = excluded.content_rev, extracted_rev = excluded.extracted_rev, described_rev = excluded.described_rev`,
			bind: [rev, rev, rev, rev]
		});
		await h.call({
			op: 'exec',
			sql: `INSERT INTO attachment_queue (kind, source_id, attachment_id, content_rev, filename, mime, state) VALUES (1, 'm1', ?, ?, 'ledger.txt', 'text/plain', ?)
				ON CONFLICT (kind, source_id, attachment_id) DO UPDATE SET state = excluded.state, content_rev = excluded.content_rev`,
			bind: [id, rev, state]
		});
		await h.call({ op: 'refreshAttachmentCoverage', key });
	}

	async function state(h: Harness): Promise<Coverage | null> {
		const rows = await h.select<[number]>('SELECT c.state FROM coverage c JOIN sources s ON s.id = c.source WHERE s.source_id = ? AND c.dimension = ?', ['m1', Dimension.attachmentText]);
		return (rows[0]?.[0] as Coverage | undefined) ?? null;
	}

	const doc = (extraction: number, contentRevision = 1) =>
		document('m1', {
			contentRevision,
			extraction,
			parts: [{ field: Field.body, text: 'The harbour lease is attached.' }],
			attachments: [{ attachmentId: 'a1', filename: 'ledger.txt', mime: 'text/plain', size: 10 }]
		});

	it('merges late attachment text into the same source and keeps it through body re-extraction', async () => {
		const h = await memory();
		await h.call({ op: 'put', doc: doc(1) });
		await queue(h, Coverage.pending);
		expect(await state(h)).toBe(Coverage.pending);
		const before = await collect(h, 'body:harbour attachment:lighthouse', ctx, options);
		expect(before.summary.matches).toBe(0);
		expect(before.summary.incomplete).toBe(1);

		expect(await h.call({ op: 'putAttachmentText', key, text: { contentRevision: 1, attachmentId: 'a1', parts: [{ text: 'Lighthouse ledger', place: 'line:1' }] } })).toBe(true);
		await queue(h, Coverage.complete);
		expect(await state(h)).toBe(Coverage.complete);
		expect((await collect(h, 'body:harbour attachment:lighthouse', ctx, options)).summary.matches).toBe(1);

		await h.call({ op: 'put', doc: doc(2) });
		expect((await collect(h, 'body:harbour attachment:lighthouse', ctx, options)).summary.matches).toBe(1);
		expect((await collect(h, 'lighthouse harbour', ctx, options)).summary.matches).toBe(1);
		expect(await state(h)).toBe(Coverage.complete);
		expect(await h.select("SELECT place FROM parts WHERE field = ? AND attachment_id = 'a1'", [Field.attachmentText])).toEqual([['line:1']]);
	});

	it('drops attachment text with a new content revision and refuses stale text', async () => {
		const h = await memory();
		await h.call({ op: 'put', doc: doc(1) });
		await queue(h, Coverage.complete);
		await h.call({ op: 'putAttachmentText', key, text: { contentRevision: 1, attachmentId: 'a1', parts: [{ text: 'Lighthouse ledger', place: 'line:1' }] } });
		await queue(h, Coverage.pending, 2);
		await h.call({ op: 'put', doc: doc(1, 2) });
		expect((await collect(h, 'attachment:lighthouse', ctx, options)).summary.matches).toBe(0);
		expect(await h.call({ op: 'putAttachmentText', key, text: { contentRevision: 1, attachmentId: 'a1', parts: [{ text: 'stale', place: 'line:1' }] } })).toBe(false);
		expect(await state(h)).toBe(Coverage.pending);
		const rows = await ftsRows(h);
		expect(rows.parts).toBe(rows.partsFts);
		expect(rows.literals).toBe(rows.literalsFts);
	});

	it('never matches a phrase across two attachments or two pages', async () => {
		const h = await memory();
		await h.call({ op: 'put', doc: doc(1) });
		await h.call({ op: 'putAttachmentText', key, text: { contentRevision: 1, attachmentId: 'a1', parts: [{ text: 'alpha beta', place: 'page:1' }, { text: 'gamma delta', place: 'page:2' }] } });
		await h.call({ op: 'putAttachmentText', key, text: { contentRevision: 1, attachmentId: 'a2', parts: [{ text: 'epsilon zeta', place: 'line:1' }] } });
		expect((await collect(h, '"alpha beta"', ctx, options)).summary.matches).toBe(1);
		expect((await collect(h, '"beta gamma"', ctx, options)).summary.matches).toBe(0);
		expect((await collect(h, '"delta epsilon"', ctx, options)).summary.matches).toBe(0);
		expect((await collect(h, 'attachment:"delta epsilon"', ctx, options)).summary.matches).toBe(0);
	});

	it('replaces the text of one attachment without touching another', async () => {
		const h = await memory();
		await h.call({ op: 'put', doc: doc(1) });
		await h.call({ op: 'putAttachmentText', key, text: { contentRevision: 1, attachmentId: 'a1', parts: [{ text: 'first draft', place: 'line:1' }] } });
		await h.call({ op: 'putAttachmentText', key, text: { contentRevision: 1, attachmentId: 'a2', parts: [{ text: 'second file', place: 'line:1' }] } });
		await h.call({ op: 'putAttachmentText', key, text: { contentRevision: 1, attachmentId: 'a1', parts: [{ text: 'final version', place: 'line:1' }] } });
		expect(await matches(h, 'parts_fts', 'draft')).toEqual([]);
		expect(await matches(h, 'parts_fts', 'final')).toEqual(['m1']);
		expect(await matches(h, 'parts_fts', 'second')).toEqual(['m1']);
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

	it('upgrades a version 8 database in place and keeps its passages under their epoch', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const h = harness();
		await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false });
		await h.call({ op: 'put', doc: document('m1') });
		await h.call({
			op: 'exec',
			sql: `${UNDO_VECTORS};
				INSERT INTO passages (source, ordinal, epoch, field, vector) SELECT id, 0, 42, 3, zeroblob(768) FROM sources;
				INSERT INTO passage_refs (source, ordinal, part, start, end) SELECT id, 0, 1, 0, 5 FROM sources;
				UPDATE meta SET value = 8 WHERE key = 'schema_version'`
		});
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false })).toEqual({ ok: true, rebuilt: false });
		expect(await h.select("SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([[SCHEMA_VERSION]]);
		expect(await h.select('SELECT epoch, ordinal, length(vector) FROM passages')).toEqual([[42, 0, 768]]);
		expect(await h.select('SELECT epoch, part, start, end FROM passage_refs')).toEqual([[42, 1, 0, 5]]);
		expect(await h.select('SELECT count(*) FROM vector_uploads')).toEqual([[0]]);
	});

	it('upgrades a version 7 database in place and starts without passages', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const h = harness();
		await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false });
		await h.call({ op: 'put', doc: document('m1') });
		await h.call({ op: 'exec', sql: `${UNDO_PASSAGES}; UPDATE meta SET value = 7 WHERE key = 'schema_version'` });
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false })).toEqual({ ok: true, rebuilt: false });
		expect(await h.select("SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([[SCHEMA_VERSION]]);
		expect(await matches(h, 'parts_fts', 'm1')).toEqual(['m1']);
		expect(await h.select('SELECT count(*) FROM passages')).toEqual([[0]]);
	});

	it('upgrades a version 6 database in place and leaves nothing to upload', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const h = harness();
		await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false });
		await h.call({ op: 'put', doc: document('m1') });
		await h.call({ op: 'exec', sql: `${UNDO_ARTIFACTS}; UPDATE meta SET value = 6 WHERE key = 'schema_version'` });
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false })).toEqual({ ok: true, rebuilt: false });
		expect(await h.select("SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([[SCHEMA_VERSION]]);
		expect(await matches(h, 'parts_fts', 'm1')).toEqual(['m1']);
		expect(await h.select('SELECT count(*) FROM artifact_index')).toEqual([[0]]);
		expect(await h.select('SELECT count(*) FROM source_queue WHERE artifact_state != 0')).toEqual([[0]]);
	});

	it('upgrades a version 5 database in place and keeps its text', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const h = harness();
		await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false });
		await h.call({ op: 'put', doc: document('m1') });
		await h.call({ op: 'exec', sql: `${UNDO_ATTACHMENTS}; UPDATE meta SET value = 5 WHERE key = 'schema_version'` });
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false })).toEqual({ ok: true, rebuilt: false });
		expect(await h.select("SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([[SCHEMA_VERSION]]);
		expect(await matches(h, 'parts_fts', 'm1')).toEqual(['m1']);
		expect(await h.select('SELECT count(*) FROM attachment_queue')).toEqual([[0]]);
	});

	it('upgrades a version 2 database in place and keeps its sources', async (ctx) => {
		if (!opfs) ctx.skip();
		const dir = directory();
		const key = randomKey();
		const h = harness();
		await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false });
		await h.call({ op: 'put', doc: document('m1') });
		await h.call({ op: 'exec', sql: `${UNDO_SYNC}; DROP TABLE checkpoints; UPDATE meta SET value = 2 WHERE key = 'schema_version'` });
		expect(await h.call({ op: 'open', directory: dir, file: '/index.db', key, rebuild: false })).toEqual({ ok: true, rebuilt: false });
		expect(await h.select("SELECT value FROM meta WHERE key = 'schema_version'")).toEqual([[SCHEMA_VERSION]]);
		expect(await h.select('SELECT source_id FROM sources')).toEqual([['m1']]);
		expect(await h.select('SELECT count(*) FROM checkpoints')).toEqual([[0]]);
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
			sql: `${UNDO_SYNC};
				DROP INDEX sources_list;
				ALTER TABLE sources DROP COLUMN list_id;
				ALTER TABLE attachments DROP COLUMN inline;
				DROP TABLE checkpoints;
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
