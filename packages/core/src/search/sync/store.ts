import type { BindValue, Database } from '@thelemail/sqlite-wasm';
import type { BlobPointer, SearchSourceKind } from '../../api/types';
import { Coverage, Dimension, Role, SourceKind } from '../sqlite/types';

export const QueueKind = { message: 1, draft: 2, scheduled: 3, collection: 4, alias: 5 } as const;
export type QueueKind = (typeof QueueKind)[keyof typeof QueueKind];

export const KIND_NAME: Readonly<Record<QueueKind, SearchSourceKind>> = {
	1: 'message',
	2: 'draft',
	3: 'scheduled',
	4: 'collection',
	5: 'alias'
};

export const QueueState = { live: 0, held: 1, deleted: 2 } as const;
export type QueueState = (typeof QueueState)[keyof typeof QueueState];

export function isDocumentKind(kind: QueueKind): kind is SourceKind {
	return kind === SourceKind.message || kind === SourceKind.draft || kind === SourceKind.scheduled;
}

export interface QueueKey {
	kind: QueueKind;
	sourceId: string;
}

export interface Revisions {
	sourceRev: number;
	contentRev: number;
	metadataRev: number;
	state: QueueState;
}

export type Pointers =
	| { kind: 'message'; body: BlobPointer; attachmentsInBody: boolean; attachments: { id: string; inline: boolean; blob: BlobPointer }[] }
	| { kind: 'draft'; body: BlobPointer }
	| { kind: 'scheduled'; senderCopyMessageId: string | null };

export interface QueueRow extends QueueKey, Revisions {
	describedRev: number;
	extractedRev: number;
	bodyState: Coverage;
	attempts: number;
	storedAt: number;
	pointers: Pointers | null;
}

export interface CoverageCount {
	dimension: Dimension;
	state: Coverage;
	count: number;
}

export interface QueueCounts {
	total: number;
	undescribed: number;
	held: number;
	waiting: number;
	bodies: Partial<Record<Coverage, number>>;
}

const ROW = 'kind, source_id, source_rev, content_rev, metadata_rev, state, described_rev, extracted_rev, body_state, attempts, stored_at, pointers';

function row(r: unknown[]): QueueRow {
	return {
		kind: r[0] as QueueKind,
		sourceId: r[1] as string,
		sourceRev: r[2] as number,
		contentRev: r[3] as number,
		metadataRev: r[4] as number,
		state: r[5] as QueueState,
		describedRev: r[6] as number,
		extractedRev: r[7] as number,
		bodyState: r[8] as Coverage,
		attempts: r[9] as number,
		storedAt: r[10] as number,
		pointers: r[11] ? (JSON.parse(r[11] as string) as Pointers) : null
	};
}

export class SyncStore {
	#db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	#exec(sql: string, bind: BindValue[]): void {
		this.#db.exec({ sql, bind });
	}

	#rows(sql: string, bind: BindValue[]): unknown[][] {
		return this.#db.selectArrays(sql, bind) as unknown[][];
	}

	merge(key: QueueKey, rev: Revisions, seen = 0): boolean {
		const before = this.get(key);
		if (before?.state === QueueState.deleted) return false;
		if (before && rev.sourceRev <= before.sourceRev) {
			if (seen > 0) this.#exec('UPDATE source_queue SET seen = max(seen, ?) WHERE kind = ? AND source_id = ?', [seen, key.kind, key.sourceId]);
			return false;
		}
		this.#exec(
			`INSERT INTO source_queue (kind, source_id, source_rev, content_rev, metadata_rev, state, seen)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (kind, source_id) DO UPDATE SET
				source_rev = excluded.source_rev,
				content_rev = max(content_rev, excluded.content_rev),
				metadata_rev = max(metadata_rev, excluded.metadata_rev),
				state = excluded.state,
				seen = max(seen, excluded.seen),
				next_at = 0,
				attempts = 0`,
			[key.kind, key.sourceId, rev.sourceRev, rev.contentRev, rev.metadataRev, rev.state, seen]
		);
		return true;
	}

	get(key: QueueKey): QueueRow | null {
		const rows = this.#rows(`SELECT ${ROW} FROM source_queue WHERE kind = ? AND source_id = ?`, [key.kind, key.sourceId]);
		return rows.length ? row(rows[0]) : null;
	}

	toDescribe(limit: number, now: number): QueueRow[] {
		return this.#rows(
			`SELECT ${ROW} FROM source_queue WHERE state != 2 AND described_rev < source_rev AND next_at <= ?
				ORDER BY stored_at = 0 DESC, stored_at DESC, kind, source_id LIMIT ?`,
			[now, limit]
		).map(row);
	}

	toExtract(limit: number, now: number): QueueRow[] {
		return this.#rows(
			`SELECT ${ROW} FROM source_queue WHERE state = 0 AND kind <= 3 AND described_rev >= content_rev AND extracted_rev < content_rev AND next_at <= ?
				ORDER BY stored_at DESC, kind, source_id LIMIT ?`,
			[now, limit]
		).map(row);
	}

	nextWake(now: number): number | null {
		const at = this.#db.selectValue(
			`SELECT min(next_at) FROM source_queue WHERE next_at > ? AND state != 2
				AND (described_rev < source_rev OR (state = 0 AND kind <= 3 AND extracted_rev < content_rev))`,
			[now]
		);
		return typeof at === 'number' ? at : null;
	}

	described(key: QueueKey, rev: Revisions, storedAt: number, pointers: Pointers | null): void {
		this.#exec(
			`UPDATE source_queue SET
				source_rev = max(source_rev, ?), content_rev = max(content_rev, ?), metadata_rev = max(metadata_rev, ?),
				state = CASE WHEN ? >= source_rev THEN ? ELSE state END,
				described_rev = max(described_rev, ?), stored_at = ?, pointers = ?, next_at = 0, attempts = 0
			WHERE kind = ? AND source_id = ? AND state != 2`,
			[rev.sourceRev, rev.contentRev, rev.metadataRev, rev.sourceRev, rev.state, rev.sourceRev, storedAt, pointers ? JSON.stringify(pointers) : null, key.kind, key.sourceId]
		);
	}

	extracted(key: QueueKey, contentRev: number, state: Coverage, epoch: number, reason: string | null): void {
		this.#exec(
			`UPDATE source_queue SET extracted_rev = ?, body_state = ?, extractor_epoch = ?, reason = ?, attempts = 0, next_at = 0
			WHERE kind = ? AND source_id = ? AND content_rev = ? AND state != 2`,
			[contentRev, state, epoch, reason, key.kind, key.sourceId, contentRev]
		);
	}

	defer(key: QueueKey, until: number, reason: string): void {
		this.#exec('UPDATE source_queue SET next_at = ?, attempts = attempts + 1, reason = ? WHERE kind = ? AND source_id = ?', [
			until,
			reason,
			key.kind,
			key.sourceId
		]);
	}

	attempts(key: QueueKey): number {
		return Number(this.#db.selectValue('SELECT attempts FROM source_queue WHERE kind = ? AND source_id = ?', [key.kind, key.sourceId]) ?? 0);
	}

	tombstone(key: QueueKey, sourceRev: number): void {
		this.#exec(
			`INSERT INTO source_queue (kind, source_id, source_rev, content_rev, metadata_rev, state, body_state)
				VALUES (?, ?, ?, 0, ?, 2, ?)
			ON CONFLICT (kind, source_id) DO UPDATE SET state = 2, source_rev = max(source_rev, excluded.source_rev), body_state = excluded.body_state, pointers = NULL`,
			[key.kind, key.sourceId, sourceRev, sourceRev, Coverage.deleted]
		);
		if (key.kind === QueueKind.collection) this.#exec('DELETE FROM source_collections WHERE collection_id = ?', [key.sourceId]);
		if (key.kind === QueueKind.alias) this.#exec('DELETE FROM source_aliases WHERE alias_id = ?', [key.sourceId]);
	}

	unseen(epoch: number, throughSeq: number): QueueKey[] {
		return this.#rows('SELECT kind, source_id FROM source_queue WHERE state != 2 AND seen < ? AND source_rev <= ?', [epoch, throughSeq]).map((r) => ({
			kind: r[0] as QueueKind,
			sourceId: r[1] as string
		}));
	}

	invalidateOne(key: QueueKey): void {
		this.#exec('UPDATE source_queue SET described_rev = 0, next_at = 0 WHERE kind = ? AND source_id = ? AND state != 2', [key.kind, key.sourceId]);
	}

	invalidate(kind: QueueKind): void {
		this.#exec('UPDATE source_queue SET described_rev = 0, next_at = 0 WHERE kind = ? AND state != 2', [kind]);
	}

	retryLocked(): number {
		this.#exec('UPDATE source_queue SET extracted_rev = 0, next_at = 0, attempts = 0 WHERE state = 0 AND body_state = ?', [Coverage.locked]);
		this.#exec(
			`UPDATE source_queue SET described_rev = 0, next_at = 0 WHERE state = 0 AND kind <= 3 AND EXISTS (
				SELECT 1 FROM sources s JOIN coverage c ON c.source = s.id
				WHERE s.kind = source_queue.kind AND s.source_id = source_queue.source_id AND c.dimension = ? AND c.state = ?)`,
			[Dimension.metadata, Coverage.locked]
		);
		return this.#db.changes() as number;
	}

	retryEpoch(epoch: number): void {
		this.#exec('UPDATE source_queue SET extracted_rev = 0, next_at = 0 WHERE state = 0 AND kind <= 3 AND extractor_epoch < ? AND body_state IN (?, ?)', [
			epoch,
			Coverage.failed,
			Coverage.resourceLimited
		]);
	}

	putCollection(id: string, c: { kind: string; parentId?: string; position: number; rev: number; sealedMeta: string; metaKeyFingerprint: string; metaSchemaVersion: number }): void {
		this.#exec(
			`INSERT OR REPLACE INTO source_collections (collection_id, kind, parent_id, position, rev, sealed_meta, meta_key_fingerprint, meta_schema_version)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, c.kind, c.parentId ?? null, c.position, c.rev, c.sealedMeta, c.metaKeyFingerprint, c.metaSchemaVersion]
		);
	}

	putAlias(id: string, relation: string, keyEpoch: number, grants: unknown): boolean {
		const before = this.#rows('SELECT relation, key_epoch, grants FROM source_aliases WHERE alias_id = ?', [id])[0];
		const encoded = JSON.stringify(grants);
		this.#exec('INSERT OR REPLACE INTO source_aliases (alias_id, relation, key_epoch, grants) VALUES (?, ?, ?, ?)', [id, relation, keyEpoch, encoded]);
		return !before || before[0] !== relation || before[1] !== keyEpoch || before[2] !== encoded;
	}

	deliveredTo(kind: SourceKind, sourceId: string): { name: string; address: string }[] {
		return this.#rows(
			`SELECT p.name, p.address FROM participants p JOIN sources s ON s.id = p.source WHERE s.kind = ? AND s.source_id = ? AND p.role = ?`,
			[kind, sourceId, Role.deliveredTo]
		).map((r) => ({ name: r[0] as string, address: r[1] as string }));
	}

	counts(): QueueCounts {
		const [total, undescribed, held, waiting] = this.#rows(
			`SELECT
				count(*) FILTER (WHERE kind <= 3 AND state != 2),
				count(*) FILTER (WHERE state != 2 AND described_rev < source_rev),
				count(*) FILTER (WHERE kind <= 3 AND state = 1),
				count(*) FILTER (WHERE state != 2 AND next_at > 0)
			FROM source_queue`,
			[]
		)[0] as number[];
		const bodies: Partial<Record<Coverage, number>> = {};
		for (const r of this.#rows(
			`SELECT CASE WHEN extracted_rev < content_rev THEN ? ELSE body_state END AS st, count(*) FROM source_queue
				WHERE kind <= 3 AND state = 0 GROUP BY st`,
			[Coverage.pending]
		)) {
			bodies[r[0] as Coverage] = r[1] as number;
		}
		return { total, undescribed, held, waiting, bodies };
	}

	coverage(): CoverageCount[] {
		return this.#rows('SELECT dimension, state, count(*) FROM coverage GROUP BY dimension, state ORDER BY dimension, state', []).map((r) => ({
			dimension: r[0] as Dimension,
			state: r[1] as Coverage,
			count: r[2] as number
		}));
	}
}
