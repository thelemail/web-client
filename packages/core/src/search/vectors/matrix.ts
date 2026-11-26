import { DIMENSIONS } from '../model/pool';

export const BLOCK_ROWS = 16_384;
export const MATRIX_CAPACITY = 400_000;

export interface MatrixVector {
	ordinal: number;
	vector: Float32Array;
}

interface Block {
	data: Int8Array;
	scale: Float32Array;
	source: Int32Array;
	ordinal: Uint16Array;
	dead: Uint8Array;
}

interface Entry {
	rows: number[];
	date: number;
}

export function quantize(v: Float32Array, out: Int8Array, at = 0): number {
	let max = 0;
	for (let d = 0; d < DIMENSIONS; d++) {
		const a = Math.abs(v[d]);
		if (a > max) max = a;
	}
	if (max === 0) {
		out.fill(0, at, at + DIMENSIONS);
		return 0;
	}
	const k = 127 / max;
	for (let d = 0; d < DIMENSIONS; d++) out[at + d] = Math.round(v[d] * k);
	return max / 127;
}

function newer(aDate: number, aSource: number, bDate: number, bSource: number): boolean {
	return aDate > bDate || (aDate === bDate && aSource > bSource);
}

class OldestFirst {
	#date: number[] = [];
	#source: number[] = [];

	get size(): number {
		return this.#date.length;
	}

	clear(): void {
		this.#date = [];
		this.#source = [];
	}

	push(date: number, source: number): void {
		this.#date.push(date);
		this.#source.push(source);
		let i = this.#date.length - 1;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (!newer(this.#date[parent], this.#source[parent], this.#date[i], this.#source[i])) break;
			this.#swap(i, parent);
			i = parent;
		}
	}

	peek(): [number, number] | null {
		return this.#date.length ? [this.#date[0], this.#source[0]] : null;
	}

	pop(): void {
		const last = this.#date.length - 1;
		this.#swap(0, last);
		this.#date.pop();
		this.#source.pop();
		let i = 0;
		for (;;) {
			const l = 2 * i + 1;
			const r = l + 1;
			let m = i;
			if (l < this.#date.length && newer(this.#date[m], this.#source[m], this.#date[l], this.#source[l])) m = l;
			if (r < this.#date.length && newer(this.#date[m], this.#source[m], this.#date[r], this.#source[r])) m = r;
			if (m === i) return;
			this.#swap(i, m);
			i = m;
		}
	}

	#swap(a: number, b: number): void {
		[this.#date[a], this.#date[b]] = [this.#date[b], this.#date[a]];
		[this.#source[a], this.#source[b]] = [this.#source[b], this.#source[a]];
	}
}

export class VectorMatrix {
	readonly epoch: number;
	readonly capacity: number;
	#blocks: Block[] = [];
	#size = 0;
	#live = 0;
	#entries = new Map<number, Entry>();
	#oldest = new OldestFirst();
	#omitted = new Set<number>();

	constructor(epoch: number, capacity = MATRIX_CAPACITY) {
		this.epoch = epoch;
		this.capacity = capacity;
	}

	get size(): number {
		return this.#size;
	}

	get live(): number {
		return this.#live;
	}

	get bytes(): number {
		return this.#blocks.length * BLOCK_ROWS * (DIMENSIONS + 4 + 4 + 2 + 1);
	}

	get omitted(): ReadonlySet<number> {
		return this.#omitted;
	}

	has(source: number): boolean {
		return this.#entries.has(source);
	}

	rowsOf(source: number): readonly number[] {
		return this.#entries.get(source)?.rows ?? [];
	}

	sourceAt(row: number): number {
		return this.#blocks[(row / BLOCK_ROWS) | 0].source[row % BLOCK_ROWS];
	}

	ordinalAt(row: number): number {
		return this.#blocks[(row / BLOCK_ROWS) | 0].ordinal[row % BLOCK_ROWS];
	}

	isDead(row: number): boolean {
		return this.#blocks[(row / BLOCK_ROWS) | 0].dead[row % BLOCK_ROWS] === 1;
	}

	#oldestLive(): [number, number] | null {
		for (;;) {
			const top = this.#oldest.peek();
			if (!top) return null;
			const entry = this.#entries.get(top[1]);
			if (entry && entry.date === top[0]) return top;
			this.#oldest.pop();
		}
	}

	add(source: number, date: number, vectors: readonly MatrixVector[]): boolean {
		this.remove(source);
		if (vectors.length === 0) {
			this.#entries.set(source, { rows: [], date });
			return true;
		}
		if (vectors.length > this.capacity) {
			this.#omitted.add(source);
			return false;
		}
		while (this.#live + vectors.length > this.capacity) {
			const oldest = this.#oldestLive();
			if (!oldest || newer(oldest[0], oldest[1], date, source)) {
				this.#omitted.add(source);
				return false;
			}
			this.remove(oldest[1]);
			this.#omitted.add(oldest[1]);
		}
		const rows: number[] = [];
		for (const v of vectors) rows.push(this.#append(source, v));
		this.#entries.set(source, { rows, date });
		this.#oldest.push(date, source);
		this.#live += rows.length;
		return true;
	}

	#append(source: number, v: MatrixVector): number {
		const row = this.#size++;
		const at = row % BLOCK_ROWS;
		if (at === 0) {
			this.#blocks.push({
				data: new Int8Array(BLOCK_ROWS * DIMENSIONS),
				scale: new Float32Array(BLOCK_ROWS),
				source: new Int32Array(BLOCK_ROWS),
				ordinal: new Uint16Array(BLOCK_ROWS),
				dead: new Uint8Array(BLOCK_ROWS)
			});
		}
		const block = this.#blocks[this.#blocks.length - 1];
		block.scale[at] = quantize(v.vector, block.data, at * DIMENSIONS);
		block.source[at] = source;
		block.ordinal[at] = v.ordinal;
		return row;
	}

	remove(source: number): void {
		this.#omitted.delete(source);
		const entry = this.#entries.get(source);
		if (!entry) return;
		this.#entries.delete(source);
		for (const row of entry.rows) this.#blocks[(row / BLOCK_ROWS) | 0].dead[row % BLOCK_ROWS] = 1;
		this.#live -= entry.rows.length;
		if (this.#size - this.#live > Math.max(BLOCK_ROWS, this.#size >> 2)) this.compact();
	}

	compact(): void {
		const old = this.#blocks;
		const size = this.#size;
		this.#blocks = [];
		this.#size = 0;
		const moved = new Map<number, number>();
		for (let row = 0; row < size; row++) {
			const b = old[(row / BLOCK_ROWS) | 0];
			const at = row % BLOCK_ROWS;
			if (b.dead[at]) continue;
			const to = this.#size++;
			const tat = to % BLOCK_ROWS;
			if (tat === 0) {
				this.#blocks.push({
					data: new Int8Array(BLOCK_ROWS * DIMENSIONS),
					scale: new Float32Array(BLOCK_ROWS),
					source: new Int32Array(BLOCK_ROWS),
					ordinal: new Uint16Array(BLOCK_ROWS),
					dead: new Uint8Array(BLOCK_ROWS)
				});
			}
			const t = this.#blocks[this.#blocks.length - 1];
			t.data.set(b.data.subarray(at * DIMENSIONS, (at + 1) * DIMENSIONS), tat * DIMENSIONS);
			t.scale[tat] = b.scale[at];
			t.source[tat] = b.source[at];
			t.ordinal[tat] = b.ordinal[at];
			moved.set(row, to);
		}
		for (const entry of this.#entries.values()) entry.rows = entry.rows.map((r) => moved.get(r)!);
	}

	scan(from: number, to: number, query: Int8Array, queryScale: number, eligible: Int32Array, sink: (row: number, member: number, score: number) => void): void {
		const end = Math.min(to, this.#size);
		for (let row = from; row < end; ) {
			const b = this.#blocks[(row / BLOCK_ROWS) | 0];
			const base = row - (row % BLOCK_ROWS);
			const stop = Math.min(end, base + BLOCK_ROWS);
			const { data, scale, source, dead } = b;
			for (let at = row - base, last = stop - base; at < last; at++) {
				if (dead[at]) continue;
				const s = source[at];
				const member = s < eligible.length ? eligible[s] : -1;
				if (member < 0) continue;
				let acc = 0;
				for (let d = 0, o = at * DIMENSIONS; d < DIMENSIONS; d += 4, o += 4) {
					acc += data[o] * query[d] + data[o + 1] * query[d + 1] + data[o + 2] * query[d + 2] + data[o + 3] * query[d + 3];
				}
				sink(base + at, member, acc * scale[at] * queryScale);
			}
			row = stop;
		}
	}
}
