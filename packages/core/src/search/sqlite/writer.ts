import type { BindValue, Database, PreparedStatement } from '@thelemail/sqlite-wasm';
import { domainOf, filenameLiterals, listKey, literals, normalize } from './analysis';
import {
	Coverage,
	Dimension,
	Field,
	Role,
	type PutResult,
	type SearchDocument,
	type SourceKey,
	type SourceMetadata
} from './types';

const STATEMENTS = {
	find: 'SELECT id, content_rev, metadata_rev, extraction FROM sources WHERE kind = ? AND source_id = ?',
	queued: 'SELECT state, content_rev FROM source_queue WHERE kind = ? AND source_id = ?',
	currentMetadata: 'SELECT thread_id, date, flags, known_flags FROM sources WHERE id = ?',
	currentCollections: 'SELECT collection_id, type FROM collections WHERE source = ?',
	insertSource: `INSERT INTO sources (kind, source_id, content_rev, metadata_rev, thread_id, message_id, list_id, date, size, flags, known_flags,
			source_rev, extraction, extractor_epoch, size_version, warnings)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	updateSource: `UPDATE sources SET content_rev = ?, metadata_rev = ?, thread_id = ?, message_id = ?, list_id = ?, date = ?, size = ?, flags = ?, known_flags = ?,
			source_rev = max(source_rev, ?), extraction = ?, extractor_epoch = ?, size_version = ?, warnings = ?
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
	insertPart: 'INSERT INTO parts (source, field, attachment_id, locator, place, text) VALUES (?, ?, ?, ?, ?, ?)',
	insertPartFts: 'INSERT INTO parts_fts (rowid, body, source, field) VALUES (?, ?, ?, ?)',
	partIds: 'SELECT id FROM parts WHERE source = ?',
	contentPartIds: 'SELECT id FROM parts WHERE source = ? AND field != ?',
	attachmentPartIds: 'SELECT id FROM parts WHERE source = ? AND field = ? AND attachment_id = ?',
	deletePartFts: 'DELETE FROM parts_fts WHERE rowid = ?',
	deleteParts: 'DELETE FROM parts WHERE source = ?',
	deletePart: 'DELETE FROM parts WHERE id = ?',
	insertLiteral: 'INSERT INTO literals (source, part) VALUES (?, ?)',
	insertLiteralFts: 'INSERT INTO literals_fts (rowid, body, source, field) VALUES (?, ?, ?, ?)',
	literalIds: 'SELECT id FROM literals WHERE source = ?',
	partLiteralIds: 'SELECT id FROM literals WHERE part = ?',
	looseLiteralIds: 'SELECT id FROM literals WHERE source = ? AND part IS NULL',
	deleteLiteralFts: 'DELETE FROM literals_fts WHERE rowid = ?',
	deleteLiterals: 'DELETE FROM literals WHERE source = ?',
	deleteLiteral: 'DELETE FROM literals WHERE id = ?',
	attachmentStates: 'SELECT q.state FROM attachment_queue q JOIN sources s ON s.kind = q.kind AND s.source_id = q.source_id AND s.content_rev = q.content_rev WHERE s.id = ?',
	deleteDimension: 'DELETE FROM coverage WHERE source = ? AND dimension = ?',
	deleteOtherCoverage: 'DELETE FROM coverage WHERE source = ? AND dimension != ?',
	readCheckpoint: 'SELECT cursor FROM checkpoints WHERE job = ?',
	writeCheckpoint: 'INSERT OR REPLACE INTO checkpoints (job, cursor) VALUES (?, ?)',
	deleteCheckpoint: 'DELETE FROM checkpoints WHERE job = ?'
} as const;

export interface Checkpoint {
	job: string;
	cursor: string | null;
}

type StatementName = keyof typeof STATEMENTS;

export const COLLECTION_TYPE = { folder: 1, label: 2 } as const;

const QUEUE_DELETED = 2;

const ATTACHMENT_SEVERITY: readonly Coverage[] = [
	Coverage.pending,
	Coverage.processing,
	Coverage.locked,
	Coverage.failed,
	Coverage.timeout,
	Coverage.passwordRequired,
	Coverage.resourceLimited,
	Coverage.partial,
	Coverage.unsupported
];

export function attachmentCoverage(states: readonly Coverage[]): Coverage | null {
	if (states.length === 0) return null;
	for (const state of ATTACHMENT_SEVERITY) {
		if (states.includes(state)) return state === Coverage.processing ? Coverage.pending : state;
	}
	return Coverage.complete;
}

export interface AttachmentText {
	contentRevision: number;
	attachmentId: string;
	parts: readonly { text: string; place: string }[];
}

function listOf(doc: SearchDocument): string | null {
	return doc.listId ? listKey(doc.listId) : null;
}

export class SearchWriter {
	#db: Database;
	#statements = new Map<StatementName, PreparedStatement>();
	#deleted = new Set<(source: number) => void>();
	#inserted = new Set<() => void>();

	constructor(db: Database) {
		this.#db = db;
	}

	#depth = 0;

	atomic<T>(fn: () => T): T {
		return this.#atomic(fn);
	}

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

	#find(key: SourceKey): { id: number; contentRev: number; metadataRev: number; extraction: number } | null {
		const s = this.#stmt('find').bind([key.kind, key.sourceId]);
		try {
			if (!s.step()) return null;
			return { id: s.getInt(0)!, contentRev: s.getInt(1)!, metadataRev: s.getInt(2)!, extraction: s.getInt(3)! };
		} finally {
			s.reset(true);
		}
	}

	#superseded(key: SourceKey, contentRevision: number): boolean {
		const s = this.#stmt('queued').bind([key.kind, key.sourceId]);
		try {
			if (!s.step()) return false;
			return s.getInt(0) === QUEUE_DELETED || s.getInt(1)! > contentRevision;
		} finally {
			s.reset(true);
		}
	}

	#currentMetadata(id: number, metadataRevision: number): SourceMetadata {
		const s = this.#stmt('currentMetadata').bind([id]);
		let meta: SourceMetadata;
		try {
			s.step();
			meta = {
				metadataRevision,
				threadId: s.get(0) as string | null,
				date: s.getInt(1)!,
				flags: s.getInt(2)!,
				knownFlags: s.getInt(3)!,
				collections: []
			};
		} finally {
			s.reset(true);
		}
		const c = this.#stmt('currentCollections').bind([id]);
		try {
			while (c.step()) meta.collections.push({ id: c.get(0) as string, type: c.getInt(1) === COLLECTION_TYPE.label ? 'label' : 'folder' });
		} finally {
			c.reset(true);
		}
		return meta;
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

	#deletePart(part: number): void {
		for (const literal of this.#column<number>('partLiteralIds', [part])) {
			this.#run('deleteLiteralFts', [literal]);
			this.#run('deleteLiteral', [literal]);
		}
		this.#run('deletePartFts', [part]);
		this.#run('deletePart', [part]);
	}

	#clearExtraction(id: number): void {
		for (const part of this.#column<number>('contentPartIds', [id, Field.attachmentText])) this.#deletePart(part);
		for (const rowid of this.#column<number>('looseLiteralIds', [id])) {
			this.#run('deleteLiteralFts', [rowid]);
			this.#run('deleteLiteral', [rowid]);
		}
		this.#run('deleteParticipants', [id]);
		this.#run('deleteAttachments', [id]);
		this.#run('deleteOtherCoverage', [id, Dimension.attachmentText]);
	}

	#refreshAttachmentCoverage(id: number, clear = true): void {
		const state = attachmentCoverage(this.#column<Coverage>('attachmentStates', [id]));
		if (state === null && !clear) return;
		if (state === null) this.#run('deleteDimension', [id, Dimension.attachmentText]);
		else this.#run('upsertCoverage', [id, Dimension.attachmentText, state]);
	}

	#writeCollections(id: number, meta: SourceMetadata): void {
		this.#run('deleteCollections', [id]);
		for (const c of meta.collections) this.#run('insertCollection', [id, c.id, COLLECTION_TYPE[c.type]]);
	}

	#addPart(id: number, field: Field, text: string, attachmentId: string | null, locator: number | null, place: string | null = null): number {
		this.#run('insertPart', [id, field, attachmentId, locator, place, text]);
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
			const part = this.#addPart(id, p.field, p.text, p.attachmentId ?? null, p.locator ?? null, p.place ?? null);
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
			if (this.#superseded(doc, doc.contentRevision)) return 'stale';
			const existing = this.#find(doc);
			const extraction = doc.extraction ?? 0;
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
					doc.knownFlags,
					doc.sourceRevision ?? 0,
					extraction,
					doc.extractorEpoch ?? 0,
					doc.sizeVersion ?? 0,
					doc.warnings ?? 0
				]);
				const id = this.#lastId();
				this.#writeContent(id, doc);
				this.#refreshAttachmentCoverage(id, false);
				for (const listener of this.#inserted) listener();
				return 'inserted';
			}
			if (doc.contentRevision < existing.contentRev) return 'stale';
			if (doc.contentRevision === existing.contentRev && extraction <= existing.extraction) {
				if (doc.metadataRevision <= existing.metadataRev) return 'unchanged';
				this.#applyMetadata(existing.id, doc);
				return 'metadata';
			}
			const meta = doc.metadataRevision >= existing.metadataRev ? doc : this.#currentMetadata(existing.id, existing.metadataRev);
			if (doc.contentRevision === existing.contentRev) this.#clearExtraction(existing.id);
			else this.#clearContent(existing.id);
			this.#run('updateSource', [
				doc.contentRevision,
				meta.metadataRevision,
				meta.threadId,
				doc.messageId,
				listOf(doc),
				meta.date,
				doc.size,
				meta.flags,
				meta.knownFlags,
				doc.sourceRevision ?? 0,
				extraction,
				doc.extractorEpoch ?? 0,
				doc.sizeVersion ?? 0,
				doc.warnings ?? 0,
				existing.id
			]);
			this.#writeContent(existing.id, { ...doc, collections: meta.collections });
			this.#refreshAttachmentCoverage(existing.id, false);
			return 'replaced';
		});
	}

	putAttachmentText(key: SourceKey, text: AttachmentText): boolean {
		return this.#atomic(() => {
			if (this.#superseded(key, text.contentRevision)) return false;
			const existing = this.#find(key);
			if (!existing || existing.contentRev !== text.contentRevision) return false;
			for (const part of this.#column<number>('attachmentPartIds', [existing.id, Field.attachmentText, text.attachmentId])) this.#deletePart(part);
			text.parts.forEach((p, locator) => {
				if (!p.text) return;
				const part = this.#addPart(existing.id, Field.attachmentText, p.text, text.attachmentId, locator, p.place);
				this.#addLiterals(existing.id, Field.attachmentText, part, literals(p.text));
			});
			this.#refreshAttachmentCoverage(existing.id);
			return true;
		});
	}

	refreshAttachmentCoverage(key: SourceKey): void {
		this.#atomic(() => {
			const existing = this.#find(key);
			if (existing) this.#refreshAttachmentCoverage(existing.id);
		});
	}

	#applyMetadata(id: number, meta: SourceMetadata): void {
		this.#run('updateMetadata', [meta.metadataRevision, meta.threadId, meta.date, meta.flags, meta.knownFlags, id]);
		this.#writeCollections(id, meta);
	}

	updateMetadata(key: SourceKey, meta: SourceMetadata): PutResult {
		return this.#atomic(() => {
			if (this.#superseded(key, Number.POSITIVE_INFINITY)) return 'stale';
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

	onInsert(listener: () => void): () => void {
		this.#inserted.add(listener);
		return () => this.#inserted.delete(listener);
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

	putBatch(docs: readonly SearchDocument[], checkpoint?: Checkpoint, also?: () => void): PutResult[] {
		return this.#atomic(() => {
			const results = docs.map((d) => this.put(d));
			also?.();
			if (checkpoint) this.#saveCheckpoint(checkpoint);
			return results;
		});
	}

	#saveCheckpoint(checkpoint: Checkpoint): void {
		if (checkpoint.cursor === null) this.#run('deleteCheckpoint', [checkpoint.job]);
		else this.#run('writeCheckpoint', [checkpoint.job, checkpoint.cursor]);
	}

	checkpoint(job: string): string | null {
		return this.#column<string>('readCheckpoint', [job])[0] ?? null;
	}

	setCheckpoint(checkpoint: Checkpoint): void {
		this.#atomic(() => this.#saveCheckpoint(checkpoint));
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
