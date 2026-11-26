import { DIMENSIONS } from '../model/pool';
import { SourceKind } from '../sqlite/types';

export function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function gaussian(next: () => number): number {
	const u = Math.max(next(), 1e-12);
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

function unit(v: Float32Array): Float32Array {
	let sum = 0;
	for (let d = 0; d < DIMENSIONS; d++) sum += v[d] * v[d];
	const n = Math.sqrt(sum);
	for (let d = 0; d < DIMENSIONS; d++) v[d] /= n;
	return v;
}

export interface CorpusShape {
	seed: number;
	sources: number;
	per: number;
	clusters?: number;
	spread?: number;
}

export const BASE_DATE = 1_700_000_000_000;

export class Corpus {
	readonly shape: Required<CorpusShape>;
	#centroids: Float32Array[];

	constructor(shape: CorpusShape) {
		this.shape = { clusters: 64, spread: 0.08, ...shape };
		const next = rng(shape.seed);
		this.#centroids = Array.from({ length: this.shape.clusters }, () => unit(Float32Array.from({ length: DIMENSIONS }, () => gaussian(next))));
	}

	#noisy(centroid: Float32Array, seed: number): Float32Array {
		const next = rng(seed);
		const v = new Float32Array(DIMENSIONS);
		for (let d = 0; d < DIMENSIONS; d++) v[d] = centroid[d] + this.shape.spread * gaussian(next);
		return unit(v);
	}

	vector(source: number, ordinal: number): Float32Array {
		const cluster = (source * 7 + ordinal * 13) % this.shape.clusters;
		return this.#noisy(this.#centroids[cluster], this.shape.seed * 1_000_003 + source * 1031 + ordinal);
	}

	query(k: number): Float32Array {
		return this.#noisy(this.#centroids[k % this.shape.clusters], this.shape.seed * 7919 + k + 1);
	}

	sourceId(i: number): string {
		return `s${i}`;
	}

	threadId(i: number): string {
		return `th${Math.floor(i / 3)}`;
	}

	date(i: number): number {
		return BASE_DATE + i * 60_000;
	}

	spam(i: number): boolean {
		return i % 50 === 49;
	}

	groupKey(i: number, group: 'thread' | 'message'): string {
		return group === 'thread' ? `t${this.threadId(i)}` : `${SourceKind.message}:${this.sourceId(i)}`;
	}
}
