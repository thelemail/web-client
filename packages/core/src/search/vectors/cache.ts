import type { Database, PreparedStatement } from '@thelemail/sqlite-wasm';
import { decodeHalf, normalized } from '../model/pool';
import type { SearchWriter } from '../sqlite/writer';
import { MATRIX_CAPACITY, VectorMatrix, type MatrixVector } from './matrix';

const BUILD_MS = 12;
const REFRESH_BATCH = 256;

export function decoded(bytes: Uint8Array): Float32Array | null {
	return normalized(decodeHalf(bytes));
}

export class VectorCache {
	#db: Database;
	#capacity: number;
	#matrix: VectorMatrix | null = null;
	#dirty = new Set<number>();
	#building = false;
	#unsubscribe: () => void;

	constructor(db: Database, writer: SearchWriter, capacity = MATRIX_CAPACITY) {
		this.#db = db;
		this.#capacity = capacity;
		this.#unsubscribe = writer.onVectors((sources) => {
			if (!this.#matrix && !this.#building) return;
			for (const s of sources) this.#dirty.add(s);
		});
	}

	get matrix(): VectorMatrix | null {
		return this.#matrix;
	}

	async ready(epoch: number, checkpoint: () => Promise<void>): Promise<VectorMatrix> {
		let matrix = this.#matrix;
		if (matrix?.epoch !== epoch) {
			this.#matrix = null;
			this.#dirty.clear();
			this.#building = true;
			try {
				matrix = await this.#build(epoch, checkpoint);
			} finally {
				this.#building = false;
			}
			this.#matrix = matrix;
		}
		await this.#refresh(matrix, checkpoint);
		return matrix;
	}

	drop(): void {
		this.#matrix = null;
		this.#dirty.clear();
	}

	dispose(): void {
		this.#unsubscribe();
		this.drop();
	}

	async #build(epoch: number, checkpoint: () => Promise<void>): Promise<VectorMatrix> {
		const matrix = new VectorMatrix(epoch, this.#capacity);
		const statement = this.#db.prepare(
			`SELECT s.id, s.date, p.ordinal, p.vector FROM sources s INDEXED BY sources_date
			JOIN passages p ON p.epoch = ? AND p.source = s.id
			ORDER BY s.date DESC, s.kind, s.source_id, p.ordinal`
		);
		try {
			statement.bind([epoch]);
			let source = -1;
			let date = 0;
			let vectors: MatrixVector[] = [];
			const flush = () => {
				if (source < 0) return;
				if (matrix.live >= matrix.capacity) matrix.omit(source);
				else matrix.add(source, date, vectors);
				vectors = [];
			};
			for (let more = true; more; ) {
				await checkpoint();
				const until = performance.now() + BUILD_MS;
				for (let n = 0; ; n++) {
					more = statement.step();
					if (!more) break;
					const id = statement.getInt(0)!;
					if (id !== source) {
						flush();
						source = id;
						date = statement.getInt(1)!;
					}
					if (matrix.live < matrix.capacity) {
						const vector = decoded(statement.get(3) as Uint8Array);
						if (vector) vectors.push({ ordinal: statement.getInt(2)!, vector });
					}
					if ((n & 255) === 255 && performance.now() > until) break;
				}
			}
			flush();
		} finally {
			statement.finalize();
		}
		return matrix;
	}

	async #refresh(matrix: VectorMatrix, checkpoint: () => Promise<void>): Promise<void> {
		if (this.#dirty.size === 0) return;
		const dirty = [...this.#dirty];
		this.#dirty.clear();
		const head = this.#db.prepare('SELECT date FROM sources WHERE id = ?');
		const rows = this.#db.prepare('SELECT ordinal, vector FROM passages WHERE epoch = ? AND source = ? ORDER BY ordinal');
		try {
			for (let i = 0; i < dirty.length; i += REFRESH_BATCH) {
				await checkpoint();
				for (const source of dirty.slice(i, i + REFRESH_BATCH)) this.#reload(matrix, source, head, rows);
			}
		} catch (err) {
			for (const source of dirty) this.#dirty.add(source);
			throw err;
		} finally {
			head.finalize();
			rows.finalize();
		}
	}

	#reload(matrix: VectorMatrix, source: number, head: PreparedStatement, rows: PreparedStatement): void {
		let date: number | null = null;
		try {
			head.bind([source]);
			if (head.step()) date = head.getInt(0)!;
		} finally {
			head.reset(true);
		}
		if (date === null) {
			matrix.remove(source);
			return;
		}
		const vectors: MatrixVector[] = [];
		try {
			rows.bind([matrix.epoch, source]);
			while (rows.step()) {
				const vector = decoded(rows.get(1) as Uint8Array);
				if (vector) vectors.push({ ordinal: rows.getInt(0)!, vector });
			}
		} finally {
			rows.reset(true);
		}
		if (vectors.length) matrix.add(source, date, vectors);
		else matrix.remove(source);
	}
}
