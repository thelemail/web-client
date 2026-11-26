// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DIMENSIONS } from '../model/pool';
import { BLOCK_ROWS, VectorMatrix, quantize } from './matrix';

function random(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function unit(next: () => number): Float32Array {
	const v = new Float32Array(DIMENSIONS);
	let sum = 0;
	for (let d = 0; d < DIMENSIONS; d++) {
		v[d] = next() * 2 - 1;
		sum += v[d] * v[d];
	}
	const n = Math.sqrt(sum);
	for (let d = 0; d < DIMENSIONS; d++) v[d] /= n;
	return v;
}

function dot(a: Float32Array, b: Float32Array): number {
	let s = 0;
	for (let d = 0; d < DIMENSIONS; d++) s += a[d] * b[d];
	return s;
}

function scores(m: VectorMatrix, q: Float32Array, eligible: Int32Array): Map<number, number> {
	const query = new Int8Array(DIMENSIONS);
	const scale = quantize(q, query);
	const out = new Map<number, number>();
	m.scan(0, m.size, query, scale, eligible, (row, _member, score) => out.set(row, score));
	return out;
}

function everyone(n: number): Int32Array {
	return Int32Array.from({ length: n }, (_, i) => i);
}

describe('VectorMatrix', () => {
	it('approximates the fp32 dot product within a small bound', () => {
		const next = random(1);
		const m = new VectorMatrix(1);
		const vectors = Array.from({ length: 500 }, () => unit(next));
		vectors.forEach((v, i) => m.add(i + 1, i, [{ ordinal: 0, vector: v }]));
		const q = unit(next);
		const approx = scores(m, q, everyone(502));
		let worst = 0;
		vectors.forEach((v, i) => (worst = Math.max(worst, Math.abs(approx.get(m.rowsOf(i + 1)[0])! - dot(v, q)))));
		expect(worst).toBeLessThan(0.01);
	});

	it('skips sources outside the eligible set and passages that were removed', () => {
		const next = random(2);
		const m = new VectorMatrix(1);
		for (let s = 1; s <= 6; s++) m.add(s, s, [{ ordinal: 0, vector: unit(next) }, { ordinal: 1, vector: unit(next) }]);
		const eligible = new Int32Array(7).fill(-1);
		eligible[2] = 0;
		eligible[4] = 1;
		eligible[5] = 2;
		m.remove(5);
		const seen = new Set([...scores(m, unit(next), eligible).keys()].map((row) => m.sourceAt(row)));
		expect(seen).toEqual(new Set([2, 4]));
		expect(m.live).toBe(10);
	});

	it('grows across blocks and compacts away removed rows', () => {
		const next = random(3);
		const m = new VectorMatrix(1);
		const v = unit(next);
		const n = BLOCK_ROWS * 2 + 10;
		for (let s = 1; s <= n; s++) m.add(s, s, [{ ordinal: 3, vector: v }]);
		expect(m.size).toBe(n);
		for (let s = 1; s <= BLOCK_ROWS + 5; s++) m.remove(s);
		expect(m.size).toBeLessThan(n);
		expect(m.live).toBe(n - BLOCK_ROWS - 5);
		const sources = new Set<number>();
		m.scan(0, m.size, new Int8Array(DIMENSIONS), 1, everyone(n + 1), (row) => sources.add(m.sourceAt(row)));
		expect(sources.size).toBe(m.live);
		expect(Math.min(...sources)).toBe(BLOCK_ROWS + 6);
		expect(m.ordinalAt(m.rowsOf(n)[0])).toBe(3);
	});

	it('keeps the most recent passages at capacity and reports the rest as omitted', () => {
		const next = random(4);
		const m = new VectorMatrix(1, 4);
		m.add(1, 100, [{ ordinal: 0, vector: unit(next) }, { ordinal: 1, vector: unit(next) }]);
		m.add(2, 300, [{ ordinal: 0, vector: unit(next) }]);
		m.add(3, 200, [{ ordinal: 0, vector: unit(next) }]);
		expect(m.add(4, 400, [{ ordinal: 0, vector: unit(next) }])).toBe(true);
		expect(m.has(1)).toBe(false);
		expect([...m.omitted]).toEqual([1]);
		expect(m.add(6, 250, [{ ordinal: 0, vector: unit(next) }])).toBe(true);
		expect(m.add(5, 50, [{ ordinal: 0, vector: unit(next) }])).toBe(false);
		expect(m.omitted.has(5)).toBe(true);
		expect(m.live).toBe(4);
		m.remove(5);
		expect(m.omitted.has(5)).toBe(false);
	});

	it('replaces a source that is added again', () => {
		const next = random(5);
		const m = new VectorMatrix(1);
		m.add(1, 1, [{ ordinal: 0, vector: unit(next) }, { ordinal: 1, vector: unit(next) }]);
		m.add(1, 1, [{ ordinal: 0, vector: unit(next) }]);
		expect(m.live).toBe(1);
		expect(m.rowsOf(1)).toHaveLength(1);
		expect(m.isDead(0)).toBe(true);
	});
});
