import type { Database } from '@thelemail/sqlite-wasm';
import type { SearchWriter } from '../sqlite/writer';
import { Coverage, Dimension, Field, SourceKind } from '../sqlite/types';
import { ArtifactState } from '../sync/store';
import { encodeHalf } from './pool';
import type { EmbeddedPassage, EmbedInput } from './protocol';
import { RECIPE } from './recipe';

const EPOCH_KEY = 'semantic_epoch';
const MODEL_KEY = 'semantic_model';
const LIVE_KEY = 'semantic_live';
const LIVE_MODEL_KEY = 'semantic_live_model';
const UNAVAILABLE_KEY = 'semantic_unavailable';
const SEED_BATCH = 1000;
const WAITING: readonly Coverage[] = [Coverage.pending, Coverage.processing];

export interface ScanEpoch {
	epoch: number;
	current: boolean;
	rebuilding: boolean;
}

export function modelId(manifestHash: string): number {
	return Number.parseInt(manifestHash.slice(0, 12), 16);
}

export interface PendingSource {
	id: number;
	contentRev: number;
	body: Coverage;
}

export class PassageStore {
	#db: Database;
	#writer: SearchWriter;

	constructor(db: Database, writer: SearchWriter) {
		this.#db = db;
		this.#writer = writer;
	}

	#meta(key: string): number | null {
		const v = this.#db.selectValue('SELECT value FROM meta WHERE key = ?', [key]);
		return typeof v === 'number' ? v : null;
	}

	#setMeta(key: string, value: number | null): void {
		if (value === null) this.#db.exec('DELETE FROM meta WHERE key = ?', { bind: [key] });
		else this.#db.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', { bind: [key, value] });
	}

	#wipe(): void {
		this.#db.exec('DELETE FROM passage_refs');
		this.#db.exec('DELETE FROM passages');
		this.#db.exec('DELETE FROM vector_uploads');
		this.#db.exec('DELETE FROM coverage WHERE dimension = ?', { bind: [Dimension.semantic] });
	}

	#dropEpoch(epoch: number): void {
		this.#db.exec('DELETE FROM passage_refs WHERE epoch = ?', { bind: [epoch] });
		this.#db.exec('DELETE FROM passages WHERE epoch = ?', { bind: [epoch] });
	}

	#keepOnly(epoch: number): void {
		this.#db.exec('DELETE FROM passage_refs WHERE epoch != ?', { bind: [epoch] });
		this.#db.exec('DELETE FROM passages WHERE epoch != ?', { bind: [epoch] });
		this.#db.exec('DELETE FROM vector_uploads WHERE epoch != ?', { bind: [epoch] });
		this.#db.exec('DELETE FROM vector_index WHERE component_epoch != ?', { bind: [epoch] });
	}

	adopt(epoch: number, model: number): boolean {
		return this.#writer.atomic(() => {
			const target = this.#meta(EPOCH_KEY);
			if (target === epoch) {
				if (this.#meta(MODEL_KEY) !== model) this.#setMeta(MODEL_KEY, model);
				return false;
			}
			if (target !== null && target !== this.#meta(LIVE_KEY)) this.#dropEpoch(target);
			this.#db.exec('DELETE FROM vector_uploads');
			this.#db.exec('DELETE FROM coverage WHERE dimension = ?', { bind: [Dimension.semantic] });
			this.#setMeta(EPOCH_KEY, epoch);
			this.#setMeta(MODEL_KEY, model);
			return true;
		});
	}

	target(): number | null {
		return this.#meta(EPOCH_KEY);
	}

	promote(): boolean {
		return this.#writer.atomic(() => {
			const target = this.#meta(EPOCH_KEY);
			if (target === null || target === this.#meta(LIVE_KEY)) return false;
			const waiting = this.#db.selectValue(`SELECT 1 FROM coverage WHERE dimension = ? AND state IN (${WAITING.join(', ')}) LIMIT 1`, [Dimension.semantic]);
			if (waiting !== undefined) return false;
			this.#keepOnly(target);
			this.#setMeta(LIVE_KEY, target);
			this.#setMeta(LIVE_MODEL_KEY, this.#meta(MODEL_KEY));
			return true;
		});
	}

	scanEpoch(model: number): ScanEpoch | null {
		const target = this.#meta(EPOCH_KEY);
		const live = this.#meta(LIVE_KEY);
		if (live !== null && this.#meta(LIVE_MODEL_KEY) === model) return { epoch: live, current: live === target, rebuilding: false };
		if (target !== null && this.#meta(MODEL_KEY) === model) return { epoch: target, current: true, rebuilding: true };
		return null;
	}

	clear(): boolean {
		return this.#writer.atomic(() => {
			const had =
				this.#meta(EPOCH_KEY) !== null ||
				this.#meta(LIVE_KEY) !== null ||
				this.#db.selectValue('SELECT 1 FROM coverage WHERE dimension = ? LIMIT 1', [Dimension.semantic]) !== undefined;
			if (!had) return false;
			this.#wipe();
			for (const key of [EPOCH_KEY, MODEL_KEY, LIVE_KEY, LIVE_MODEL_KEY]) this.#setMeta(key, null);
			return true;
		});
	}

	unavailableSince(): number | null {
		return this.#meta(UNAVAILABLE_KEY);
	}

	setUnavailable(at: number | null): void {
		this.#writer.atomic(() => this.#setMeta(UNAVAILABLE_KEY, at));
	}

	seed(): number {
		return this.#writer.atomic(() => {
			let total = 0;
			for (;;) {
				const before = Number(this.#db.selectValue('SELECT total_changes()'));
				this.#db.exec(
					`INSERT INTO coverage (source, dimension, state)
					SELECT b.source, ?, ? FROM coverage b
					WHERE b.dimension = ? AND NOT EXISTS (SELECT 1 FROM coverage x WHERE x.source = b.source AND x.dimension = ?)
					LIMIT ?`,
					{ bind: [Dimension.semantic, Coverage.pending, Dimension.body, Dimension.semantic, SEED_BATCH] }
				);
				const added = Number(this.#db.selectValue('SELECT total_changes()')) - before;
				total += added;
				if (added < SEED_BATCH) return total;
			}
		});
	}

	pending(limit: number): PendingSource[] {
		return (
			this.#db.selectArrays(
				`SELECT s.id, s.content_rev, b.state FROM coverage c
				JOIN sources s ON s.id = c.source
				JOIN coverage b ON b.source = c.source AND b.dimension = ?
				LEFT JOIN coverage a ON a.source = c.source AND a.dimension = ?
				WHERE c.dimension = ? AND c.state = ? AND b.state NOT IN (${WAITING.join(', ')}) AND (a.state IS NULL OR a.state NOT IN (${WAITING.join(', ')}))
				AND NOT EXISTS (SELECT 1 FROM vector_index v WHERE s.kind = ? AND v.source_id = s.source_id AND v.content_rev = s.content_rev AND v.component_epoch = ? AND v.state = 0)
				ORDER BY s.date DESC, s.id DESC
				LIMIT ?`,
				[Dimension.body, Dimension.attachmentText, Dimension.semantic, Coverage.pending, SourceKind.message, this.#meta(EPOCH_KEY) ?? -1, limit]
			) as [number, number, number][]
		).map(([id, contentRev, body]) => ({ id, contentRev, body: body as Coverage }));
	}

	input(id: number): EmbedInput {
		const subject = this.#db.selectValue('SELECT text FROM parts WHERE source = ? AND field = ? ORDER BY id LIMIT 1', [id, Field.subject]);
		const parts = (
			this.#db.selectArrays(`SELECT id, field, text, attachment_id, place FROM parts WHERE source = ? AND field IN (${RECIPE.fields.join(', ')}) ORDER BY id`, [id]) as [
				number,
				number,
				string,
				string | null,
				string | null
			][]
		).map(([ordinal, field, text, attachmentId, place]) => ({ ordinal, field: field as Field, text, attachmentId, place }));
		return { subject: typeof subject === 'string' ? subject : null, parts };
	}

	#current(id: number, contentRev: number): boolean {
		const rev = this.#db.selectValue('SELECT content_rev FROM sources WHERE id = ?', [id]);
		const state = this.#db.selectValue('SELECT state FROM coverage WHERE source = ? AND dimension = ?', [id, Dimension.semantic]);
		return rev === contentRev && state === Coverage.pending;
	}

	put(id: number, contentRev: number, epoch: number, passages: readonly EmbeddedPassage[], hydratedRev: number | null = null): boolean {
		return this.#writer.atomic(() => {
			if (this.#meta(EPOCH_KEY) !== epoch || !this.#current(id, contentRev)) return false;
			this.#db.exec('DELETE FROM passage_refs WHERE epoch = ? AND source = ?', { bind: [epoch, id] });
			this.#db.exec('DELETE FROM passages WHERE epoch = ? AND source = ?', { bind: [epoch, id] });
			passages.forEach((p, ordinal) => {
				this.#db.exec('INSERT INTO passages (epoch, source, ordinal, field, attachment_id, place, vector) VALUES (?, ?, ?, ?, ?, ?, ?)', {
					bind: [epoch, id, ordinal, p.field, p.attachmentId, p.place, encodeHalf(p.vector)]
				});
				for (const r of p.refs) {
					this.#db.exec('INSERT OR IGNORE INTO passage_refs (epoch, source, ordinal, part, start, end) VALUES (?, ?, ?, ?, ?, ?)', {
						bind: [epoch, id, ordinal, r.part, r.start, r.end]
					});
				}
			});
			this.#db.exec('UPDATE coverage SET state = ? WHERE source = ? AND dimension = ?', { bind: [Coverage.complete, id, Dimension.semantic] });
			if (this.#db.selectValue('SELECT kind FROM sources WHERE id = ?', [id]) === SourceKind.message) {
				const state = hydratedRev === null ? ArtifactState.due : ArtifactState.clean;
				this.#db.exec(
					`INSERT INTO vector_uploads (source, epoch, state, rev, upload_at) VALUES (?, ?, ?, ?, 0)
					ON CONFLICT (source) DO UPDATE SET epoch = excluded.epoch, state = excluded.state, rev = max(rev, excluded.rev), upload_at = 0`,
					{ bind: [id, epoch, state, hydratedRev ?? 0] }
				);
			}
			this.#writer.touchVectors(id);
			return true;
		});
	}

	mark(id: number, contentRev: number, state: Coverage): boolean {
		return this.#writer.atomic(() => {
			if (!this.#current(id, contentRev)) return false;
			this.#db.exec('UPDATE coverage SET state = ? WHERE source = ? AND dimension = ?', { bind: [state, id, Dimension.semantic] });
			return true;
		});
	}

	retryFailed(): void {
		this.#writer.atomic(() => {
			this.#db.exec('UPDATE coverage SET state = ? WHERE dimension = ? AND state = ?', { bind: [Coverage.pending, Dimension.semantic, Coverage.failed] });
		});
	}

	count(epoch?: number): number {
		if (epoch === undefined) return Number(this.#db.selectValue('SELECT count(*) FROM passages'));
		return Number(this.#db.selectValue('SELECT count(*) FROM passages WHERE epoch = ?', [epoch]));
	}
}
