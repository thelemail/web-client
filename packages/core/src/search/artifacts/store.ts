import type { BindValue, Database } from '@thelemail/sqlite-wasm';
import { Coverage } from '../sqlite/types';
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
		this.#exec(
			`UPDATE source_queue SET artifact_rev = 0, upload_at = 0,
				artifact_state = CASE WHEN kind = ? AND state = 0 AND extracted_rev = content_rev AND body_state = ? THEN ? ELSE ? END`,
			[MESSAGE, Coverage.complete, ArtifactState.due, ArtifactState.clean]
		);
	}

	clearIndex(): void {
		this.#exec('DELETE FROM artifact_index');
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
