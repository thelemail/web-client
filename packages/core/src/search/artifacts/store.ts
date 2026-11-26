import type { BindValue, Database } from '@thelemail/sqlite-wasm';
import { Coverage, Dimension, SourceKind } from '../sqlite/types';
import { ArtifactState, QueueKind } from '../sync/store';

export const IndexState = { listed: 0, hydrated: 1, rejected: 2 } as const;
export type IndexState = (typeof IndexState)[keyof typeof IndexState];

export interface Listed {
	sourceId: string;
	contentRev: number;
	componentEpoch: number;
	extractionRev: number;
	seq: number;
	state: IndexState;
}

export interface HydrateRow {
	sourceId: string;
	contentRev: number;
	componentEpoch: number;
}

export interface UploadRow {
	sourceId: string;
	contentRev: number;
	artifactRev: number;
}

export interface VectorRow {
	source: number;
	sourceId: string;
	contentRev: number;
	rev: number;
}

export interface ArtifactCounts {
	listed: number;
	hydrated: number;
	rejected: number;
	due: number;
	localOnly: number;
}

const MESSAGE = QueueKind.message;

export class ArtifactStore {
	#db: Database;

	constructor(db: Database) {
		this.#db = db;
	}

	#exec(sql: string, bind: BindValue[] = []): void {
		this.#db.exec({ sql, bind });
	}

	#rows(sql: string, bind: BindValue[]): unknown[][] {
		return this.#db.selectArrays(sql, bind) as unknown[][];
	}

	reset(): void {
		this.#exec('DELETE FROM artifact_index');
		this.#exec('DELETE FROM vector_index');
		this.#exec('UPDATE vector_uploads SET rev = 0, upload_at = 0, state = ?', [ArtifactState.due]);
		this.#exec(
			`UPDATE source_queue SET artifact_rev = 0, upload_at = 0,
				artifact_state = CASE WHEN kind = ? AND state = 0 AND extracted_rev = content_rev AND body_state = ? THEN ? ELSE ? END`,
			[MESSAGE, Coverage.complete, ArtifactState.due, ArtifactState.clean]
		);
	}

	clearIndex(): void {
		this.#exec('DELETE FROM artifact_index');
		this.#exec('DELETE FROM vector_index');
	}

	listVectors(items: readonly Listed[]): void {
		for (const i of items) {
			this.#exec(
				`INSERT INTO vector_index (source_id, content_rev, component_epoch, extraction_rev, seq, state) VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT (source_id, component_epoch) DO UPDATE SET
					content_rev = excluded.content_rev, extraction_rev = excluded.extraction_rev, seq = excluded.seq, state = excluded.state
				WHERE excluded.seq > vector_index.seq`,
				[i.sourceId, i.contentRev, i.componentEpoch, i.extractionRev, i.seq, i.state]
			);
			this.#exec('UPDATE vector_uploads SET rev = max(rev, ?) WHERE epoch = ? AND source = (SELECT id FROM sources WHERE kind = ? AND source_id = ? AND content_rev = ?)', [
				i.extractionRev,
				i.componentEpoch,
				SourceKind.message,
				i.sourceId,
				i.contentRev
			]);
		}
	}

	vectorsToHydrate(epoch: number, limit: number): VectorRow[] {
		return this.#rows(
			`SELECT s.id, v.source_id, v.content_rev, v.extraction_rev FROM vector_index v
				JOIN sources s ON s.kind = ? AND s.source_id = v.source_id AND s.content_rev = v.content_rev
				JOIN coverage c ON c.source = s.id AND c.dimension = ? AND c.state = ?
				JOIN coverage b ON b.source = s.id AND b.dimension = ? AND b.state NOT IN (?, ?)
				LEFT JOIN coverage a ON a.source = s.id AND a.dimension = ?
				WHERE v.component_epoch = ? AND v.state = 0 AND (a.state IS NULL OR a.state NOT IN (?, ?))
				ORDER BY s.date DESC, s.id DESC LIMIT ?`,
			[
				SourceKind.message,
				Dimension.semantic,
				Coverage.pending,
				Dimension.body,
				Coverage.pending,
				Coverage.processing,
				Dimension.attachmentText,
				epoch,
				Coverage.pending,
				Coverage.processing,
				limit
			]
		).map((r) => ({ source: r[0] as number, sourceId: r[1] as string, contentRev: r[2] as number, rev: r[3] as number }));
	}

	markVectors(sourceId: string, epoch: number, state: IndexState): void {
		this.#exec('UPDATE vector_index SET state = ? WHERE source_id = ? AND component_epoch = ?', [state, sourceId, epoch]);
	}

	dropVectors(sourceId: string, epoch: number): void {
		this.#exec('DELETE FROM vector_index WHERE source_id = ? AND component_epoch = ?', [sourceId, epoch]);
	}

	vectorsToUpload(epoch: number, limit: number, now: number): VectorRow[] {
		return this.#rows(
			`SELECT u.source, s.source_id, s.content_rev, u.rev FROM vector_uploads u JOIN sources s ON s.id = u.source
				WHERE u.state = ? AND u.epoch = ? AND u.upload_at <= ? AND s.kind = ?
				ORDER BY s.date DESC, s.id DESC LIMIT ?`,
			[ArtifactState.due, epoch, now, SourceKind.message, limit]
		).map((r) => ({ source: r[0] as number, sourceId: r[1] as string, contentRev: r[2] as number, rev: r[3] as number }));
	}

	claimVectors(rows: readonly VectorRow[]): void {
		for (const r of rows) this.#exec('UPDATE vector_uploads SET state = ? WHERE source = ? AND state = ?', [ArtifactState.sealing, r.source, ArtifactState.due]);
	}

	recoverVectors(): void {
		this.#exec('UPDATE vector_uploads SET state = ? WHERE state = ?', [ArtifactState.due, ArtifactState.sealing]);
	}

	uploadedVectors(source: number, rev: number): void {
		this.#exec('UPDATE vector_uploads SET rev = max(rev, ?), state = ?, upload_at = 0 WHERE source = ? AND state = ?', [rev, ArtifactState.clean, source, ArtifactState.sealing]);
	}

	settleVectors(source: number, state: ArtifactState): void {
		this.#exec('UPDATE vector_uploads SET state = ?, upload_at = 0 WHERE source = ? AND state = ?', [state, source, ArtifactState.sealing]);
	}

	deferVectors(source: number, until: number): void {
		this.#exec('UPDATE vector_uploads SET state = ?, upload_at = ? WHERE source = ? AND state IN (?, ?)', [ArtifactState.due, until, source, ArtifactState.due, ArtifactState.sealing]);
	}

	nextVectorUpload(epoch: number, now: number): number | null {
		const at = this.#db.selectValue('SELECT min(upload_at) FROM vector_uploads WHERE state = ? AND epoch = ? AND upload_at > ?', [ArtifactState.due, epoch, now]);
		return typeof at === 'number' ? at : null;
	}

	list(items: readonly Listed[]): void {
		for (const i of items) {
			this.#exec(
				`INSERT INTO artifact_index (kind, source_id, content_rev, component_epoch, extraction_rev, seq, state) VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT (kind, source_id) DO UPDATE SET
					content_rev = excluded.content_rev, component_epoch = excluded.component_epoch, extraction_rev = excluded.extraction_rev,
					seq = excluded.seq, state = excluded.state
				WHERE excluded.seq > artifact_index.seq`,
				[MESSAGE, i.sourceId, i.contentRev, i.componentEpoch, i.extractionRev, i.seq, i.state]
			);
			this.#exec('UPDATE source_queue SET artifact_rev = max(artifact_rev, ?) WHERE kind = ? AND source_id = ? AND content_rev = ?', [
				i.extractionRev,
				MESSAGE,
				i.sourceId,
				i.contentRev
			]);
		}
	}

	toHydrate(limit: number): HydrateRow[] {
		return this.#rows(
			`SELECT a.source_id, a.content_rev, a.component_epoch FROM artifact_index a
				JOIN source_queue q ON q.kind = a.kind AND q.source_id = a.source_id
				WHERE a.state = 0 AND q.state = 0 AND q.content_rev = a.content_rev AND q.described_rev >= q.content_rev AND q.extracted_rev < q.content_rev
				ORDER BY q.stored_at DESC, a.source_id LIMIT ?`,
			[limit]
		).map((r) => ({ sourceId: r[0] as string, contentRev: r[1] as number, componentEpoch: r[2] as number }));
	}

	mark(sourceId: string, contentRev: number, state: IndexState): void {
		this.#exec('UPDATE artifact_index SET state = ? WHERE kind = ? AND source_id = ? AND content_rev = ?', [state, MESSAGE, sourceId, contentRev]);
	}

	drop(sourceId: string, contentRev: number): void {
		this.#exec('DELETE FROM artifact_index WHERE kind = ? AND source_id = ? AND content_rev = ?', [MESSAGE, sourceId, contentRev]);
	}

	hydrated(sourceId: string, contentRev: number, extractionRev: number): void {
		this.mark(sourceId, contentRev, IndexState.hydrated);
		this.#exec('UPDATE source_queue SET artifact_rev = ?, artifact_state = ? WHERE kind = ? AND source_id = ? AND content_rev = ?', [
			extractionRev,
			ArtifactState.clean,
			MESSAGE,
			sourceId,
			contentRev
		]);
	}

	toUpload(limit: number, now: number): UploadRow[] {
		return this.#rows(
			`SELECT q.source_id, q.content_rev, q.artifact_rev FROM source_queue q
				WHERE q.artifact_state = 1 AND q.kind = ? AND q.state = 0 AND q.extracted_rev = q.content_rev AND q.upload_at <= ?
				AND NOT EXISTS (SELECT 1 FROM attachment_queue a WHERE a.kind = q.kind AND a.source_id = q.source_id AND a.content_rev = q.content_rev AND a.state = 0)
				ORDER BY q.stored_at DESC, q.source_id LIMIT ?`,
			[MESSAGE, now, limit]
		).map((r) => ({ sourceId: r[0] as string, contentRev: r[1] as number, artifactRev: r[2] as number }));
	}

	claim(rows: readonly UploadRow[]): void {
		for (const r of rows) {
			this.#exec('UPDATE source_queue SET artifact_state = ? WHERE kind = ? AND source_id = ? AND content_rev = ? AND artifact_state = ?', [
				ArtifactState.sealing,
				MESSAGE,
				r.sourceId,
				r.contentRev,
				ArtifactState.due
			]);
		}
	}

	recover(): void {
		this.#exec('UPDATE source_queue SET artifact_state = ? WHERE artifact_state = ?', [ArtifactState.due, ArtifactState.sealing]);
	}

	uploaded(sourceId: string, contentRev: number, extractionRev: number): void {
		this.#exec('UPDATE source_queue SET artifact_rev = max(artifact_rev, ?) WHERE kind = ? AND source_id = ? AND content_rev = ?', [
			extractionRev,
			MESSAGE,
			sourceId,
			contentRev
		]);
		this.settle(sourceId, contentRev, ArtifactState.clean);
	}

	settle(sourceId: string, contentRev: number, state: ArtifactState): void {
		this.#exec('UPDATE source_queue SET artifact_state = ?, upload_at = 0 WHERE kind = ? AND source_id = ? AND content_rev = ? AND artifact_state = ?', [
			state,
			MESSAGE,
			sourceId,
			contentRev,
			ArtifactState.sealing
		]);
	}

	defer(sourceId: string, contentRev: number, until: number): void {
		this.#exec('UPDATE source_queue SET artifact_state = ?, upload_at = ? WHERE kind = ? AND source_id = ? AND content_rev = ? AND artifact_state IN (?, ?)', [
			ArtifactState.due,
			until,
			MESSAGE,
			sourceId,
			contentRev,
			ArtifactState.due,
			ArtifactState.sealing
		]);
	}

	nextUpload(now: number): number | null {
		const at = this.#db.selectValue('SELECT min(upload_at) FROM source_queue WHERE artifact_state = 1 AND state = 0 AND upload_at > ?', [now]);
		return typeof at === 'number' ? at : null;
	}

	unextracted(): number {
		return Number(
			this.#db.selectValue(
				`SELECT count(*) FROM source_queue q WHERE q.state = 0 AND q.kind = ? AND q.extracted_rev < q.content_rev
					AND NOT EXISTS (SELECT 1 FROM artifact_index a WHERE a.kind = q.kind AND a.source_id = q.source_id AND a.content_rev = q.content_rev)`,
				[MESSAGE]
			)
		);
	}

	counts(): ArtifactCounts {
		const [listed, hydrated, rejected] = this.#rows(
			`SELECT count(*) FILTER (WHERE state = 0), count(*) FILTER (WHERE state = 1), count(*) FILTER (WHERE state = 2) FROM artifact_index`,
			[]
		)[0] as number[];
		const [due, localOnly] = this.#rows(
			'SELECT count(*) FILTER (WHERE artifact_state IN (1, 3)), count(*) FILTER (WHERE artifact_state = 2) FROM source_queue WHERE state = 0 AND kind = ?',
			[MESSAGE]
		)[0] as number[];
		return { listed, hydrated, rejected, due, localOnly };
	}
}
