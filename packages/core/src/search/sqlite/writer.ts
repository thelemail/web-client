import type { BindValue, Database, PreparedStatement } from '@thelemail/sqlite-wasm';
import { domainOf, filenameLiterals, listKey, literals, normalize } from './analysis';
import {
	Field,
	Role,
	type Dimension,
	type Coverage,
	type PutResult,
	type SearchDocument,
	type SourceKey,
	type SourceMetadata
} from './types';

const STATEMENTS = {
	find: 'SELECT id, content_rev, metadata_rev FROM sources WHERE kind = ? AND source_id = ?',
	insertSource: `INSERT INTO sources (kind, source_id, content_rev, metadata_rev, thread_id, message_id, list_id, date, size, flags, known_flags)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	updateSource: `UPDATE sources SET content_rev = ?, metadata_rev = ?, thread_id = ?, message_id = ?, list_id = ?, date = ?, size = ?, flags = ?, known_flags = ?
		WHERE id = ?`,
	updateMetadata: 'UPDATE sources SET metadata_rev = ?, thread_id = ?, date = ?, flags = ?, known_flags = ? WHERE id = ?',
	deleteSource: 'DELETE FROM sources WHERE id = ?',
	insertParticipant: 'INSERT INTO participants (source, role, name, address, domain) VALUES (?, ?, ?, ?, ?)',
	deleteParticipants: 'DELETE FROM participants WHERE source = ?',
	insertCollection: 'INSERT OR IGNORE INTO collections (source, collection_id, type) VALUES (?, ?, ?)',
	deleteCollections: 'DELETE FROM collections WHERE source = ?',
	insertAttachment: 'INSERT OR REPLACE INTO attachments (source, attachment_id, filename, mime, size, inline) VALUES (?, ?, ?, ?, ?, ?)',
	deleteAttachments: 'DELETE FROM attachments WHERE source = ?',
	upsertCoverage: 'INSERT OR REPLACE INTO coverage (source, dimension, state) VALUES (?, ?, ?)',
	deleteCoverage: 'DELETE FROM coverage WHERE source = ?',
	insertPart: 'INSERT INTO parts (source, field, attachment_id, locator, text) VALUES (?, ?, ?, ?, ?)',
	insertPartFts: 'INSERT INTO parts_fts (rowid, body, source, field) VALUES (?, ?, ?, ?)',
	partIds: 'SELECT id FROM parts WHERE source = ?',
	deletePartFts: 'DELETE FROM parts_fts WHERE rowid = ?',
	deleteParts: 'DELETE FROM parts WHERE source = ?',
	insertLiteral: 'INSERT INTO literals (source, part) VALUES (?, ?)',
	insertLiteralFts: 'INSERT INTO literals_fts (rowid, body, source, field) VALUES (?, ?, ?, ?)',
	literalIds: 'SELECT id FROM literals WHERE source = ?',
	deleteLiteralFts: 'DELETE FROM literals_fts WHERE rowid = ?',
	deleteLiterals: 'DELETE FROM literals WHERE source = ?'
} as const;

type StatementName = keyof typeof STATEMENTS;

const COLLECTION_TYPE = { folder: 1, label: 2 } as const;

function listOf(doc: SearchDocument): string | null {
	return doc.listId ? listKey(doc.listId) : null;
}

export class SearchWriter {
	#db: Database;
	#statements = new Map<StatementName, PreparedStatement>();
	#deleted = new Set<(source: number) => void>();

	constructor(db: Database) {
		this.#db = db;
	}

	#depth = 0;

	#atomic<T>(fn: () => T): T {
		if (this.#depth > 0) return fn();
		this.#depth++;
		try {
			return this.#db.transaction('IMMEDIATE', fn);
		} finally {
			this.#depth--;
		}
	}

	#stmt(name: StatementName): PreparedStatement {
		let s = this.#statements.get(name);
		if (!s) {
			s = this.#db.prepare(STATEMENTS[name]);
			this.#statements.set(name, s);
		}
		return s;
	}

	#run(name: StatementName, values: readonly BindValue[]): void {
		this.#stmt(name).bind(values).stepReset();
	}

	#lastId(): number {
		return Number(this.#db.selectValue('SELECT last_insert_rowid()'));
	}

	#column<T>(name: StatementName, values: readonly BindValue[]): T[] {
		const s = this.#stmt(name).bind(values);
		const out: T[] = [];
		try {
			while (s.step()) out.push(s.get(0) as T);
		} finally {
			s.reset(true);
		}
		return out;
	}

	#find(key: SourceKey): { id: number; contentRev: number; metadataRev: number } | null {
		const s = this.#stmt('find').bind([key.kind, key.sourceId]);
		try {
			if (!s.step()) return null;
			return { id: s.getInt(0)!, contentRev: s.getInt(1)!, metadataRev: s.getInt(2)! };
		} finally {
			s.reset(true);
		}
	}

	#clearContent(id: number): void {
		for (const rowid of this.#column<number>('partIds', [id])) this.#run('deletePartFts', [rowid]);
		for (const rowid of this.#column<number>('literalIds', [id])) this.#run('deleteLiteralFts', [rowid]);
		this.#run('deleteParts', [id]);
		this.#run('deleteLiterals', [id]);
		this.#run('deleteParticipants', [id]);
		this.#run('deleteAttachments', [id]);
		this.#run('deleteCoverage', [id]);
	}

	#writeCollections(id: number, meta: SourceMetadata): void {
		this.#run('deleteCollections', [id]);
		for (const c of meta.collections) this.#run('insertCollection', [id, c.id, COLLECTION_TYPE[c.type]]);
	}

	#addPart(id: number, field: Field, text: string, attachmentId: string | null, locator: number | null): number {
		this.#run('insertPart', [id, field, attachmentId, locator, text]);
		const part = this.#lastId();
		this.#run('insertPartFts', [part, normalize(text), id, field]);
		return part;
	}

	#addLiterals(id: number, field: Field, part: number | null, values: Iterable<string>): void {
		for (const value of values) {
			this.#run('insertLiteral', [id, part]);
			this.#run('insertLiteralFts', [this.#lastId(), value, id, field]);
		}
	}

	#writeContent(id: number, doc: SearchDocument): void {
		if (doc.subject) {
			const part = this.#addPart(id, Field.subject, doc.subject, null, null);
			this.#addLiterals(id, Field.subject, part, literals(doc.subject));
		}
		for (const p of doc.participants) {
			const address = normalize(p.address).toLowerCase();
			this.#run('insertParticipant', [id, p.role, p.name, address, domainOf(address)]);
			if (p.role === Role.deliveredTo) continue;
			const text = p.name ? `${p.name} ${p.address}` : p.address;
			const part = this.#addPart(id, Field.participant, text, null, p.role);
			this.#addLiterals(id, Field.participant, part, new Set([address, ...literals(text)]));
		}
		for (const a of doc.attachments) {
			this.#run('insertAttachment', [id, a.attachmentId, a.filename, a.mime, a.size, a.inline ? 1 : 0]);
			const part = this.#addPart(id, Field.attachmentName, a.filename, a.attachmentId, null);
			this.#addLiterals(id, Field.attachmentName, part, filenameLiterals(a.filename));
		}
		for (const p of doc.parts) {
			if (p.text.length === 0) continue;
			const part = this.#addPart(id, p.field, p.text, p.attachmentId ?? null, p.locator ?? null);
			this.#addLiterals(id, p.field, part, literals(p.text));
		}
		if (doc.messageId) this.#addLiterals(id, Field.identifier, null, [doc.messageId]);
		for (const [dimension, state] of Object.entries(doc.coverage) as [string, Coverage][]) {
			this.#run('upsertCoverage', [id, Number(dimension), state]);
		}
		this.#writeCollections(id, doc);
	}

	put(doc: SearchDocument): PutResult {
		return this.#atomic(() => {
			const existing = this.#find(doc);
			if (!existing) {
				this.#run('insertSource', [
					doc.kind,
					doc.sourceId,
					doc.contentRevision,
					doc.metadataRevision,
					doc.threadId,
					doc.messageId,
					listOf(doc),
					doc.date,
					doc.size,
					doc.flags,
					doc.knownFlags
				]);
				this.#writeContent(this.#lastId(), doc);
				return 'inserted';
			}
			if (doc.contentRevision < existing.contentRev) return 'stale';
			if (doc.contentRevision === existing.contentRev) {
				if (doc.metadataRevision <= existing.metadataRev) return 'unchanged';
				this.#applyMetadata(existing.id, doc);
				return 'metadata';
			}
			this.#clearContent(existing.id);
			this.#run('updateSource', [
				doc.contentRevision,
				Math.max(doc.metadataRevision, existing.metadataRev),
				doc.threadId,
				doc.messageId,
				listOf(doc),
				doc.date,
				doc.size,
				doc.flags,
				doc.knownFlags,
				existing.id
			]);
			this.#writeContent(existing.id, doc);
			return 'replaced';
		});
	}

	#applyMetadata(id: number, meta: SourceMetadata): void {
		this.#run('updateMetadata', [meta.metadataRevision, meta.threadId, meta.date, meta.flags, meta.knownFlags, id]);
		this.#writeCollections(id, meta);
	}

	updateMetadata(key: SourceKey, meta: SourceMetadata): PutResult {
		return this.#atomic(() => {
			const existing = this.#find(key);
			if (!existing) return 'stale';
			if (meta.metadataRevision <= existing.metadataRev) return 'unchanged';
			this.#applyMetadata(existing.id, meta);
			return 'metadata';
		});
	}

	setCoverage(key: SourceKey, dimension: Dimension, state: Coverage): boolean {
		return this.#atomic(() => {
			const existing = this.#find(key);
			if (!existing) return false;
			this.#run('upsertCoverage', [existing.id, dimension, state]);
			return true;
		});
	}

	onDelete(listener: (source: number) => void): () => void {
		this.#deleted.add(listener);
		return () => this.#deleted.delete(listener);
	}

	delete(key: SourceKey): boolean {
		const removed = this.#atomic(() => {
			const existing = this.#find(key);
			if (!existing) return null;
			this.#clearContent(existing.id);
			this.#run('deleteCollections', [existing.id]);
			this.#run('deleteSource', [existing.id]);
			return existing.id;
		});
		if (removed === null) return false;
		for (const listener of this.#deleted) listener(removed);
		return true;
	}

	putBatch(docs: readonly SearchDocument[]): PutResult[] {
		return this.#atomic(() => docs.map((d) => this.put(d)));
	}

	close(): void {
		for (const s of this.#statements.values()) s.finalize();
		this.#statements.clear();
	}
}

export type MaintenanceStep = 'merge' | 'optimize';

const MERGE_PAGES = 64;

export function maintain(db: Database, step: MaintenanceStep): boolean {
	return db.transaction('IMMEDIATE', () => {
		let worked = false;
		for (const table of ['parts_fts', 'literals_fts']) {
			const before = db.selectValue('SELECT total_changes()') as number;
			if (step === 'merge') db.exec(`INSERT INTO ${table} (${table}, rank) VALUES ('merge', ${MERGE_PAGES})`);
			else db.exec(`INSERT INTO ${table} (${table}) VALUES ('optimize')`);
			if ((db.selectValue('SELECT total_changes()') as number) - before > 1) worked = true;
		}
		return worked;
	});
}

export function integrityCheck(db: Database): boolean {
	try {
		db.exec("INSERT INTO parts_fts (parts_fts) VALUES ('integrity-check')");
		db.exec("INSERT INTO literals_fts (literals_fts) VALUES ('integrity-check')");
		return db.selectValue('PRAGMA quick_check') === 'ok';
	} catch {
		return false;
	}
}
