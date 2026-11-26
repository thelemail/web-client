// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { GroupHeap } from './topk';

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

function bruteForce(offers: [number, number, number][], k: number): [number, number][] {
	const best = new Map<number, number>();
	for (const [group, score] of offers) best.set(group, Math.max(best.get(group) ?? -Infinity, score));
	return [...best].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, k);
}

describe('GroupHeap', () => {
	it('keeps the best groups by their maximum passage, the same as grouping everything first', () => {
		const next = random(7);
		for (const [groups, offers, k] of [
			[50, 400, 10],
			[5000, 40_000, 1000],
			[1200, 20_000, 1000]
		] as const) {
			const list: [number, number, number][] = [];
			for (let i = 0; i < offers; i++) list.push([Math.floor(next() * groups), Math.round(next() * 1000) / 1000, i]);
			const heap = new GroupHeap(k);
			for (const [group, score, item] of list) heap.offer(group, score, item);
			expect(heap.groups().map((g) => [g.group, g.score])).toEqual(bruteForce(list, k));
		}
	});

	it('breaks ties on the lower group id whatever the order of arrival', () => {
		const forward = new GroupHeap(2);
		const backward = new GroupHeap(2);
		const offers: [number, number][] = [
			[5, 0.5],
			[3, 0.5],
			[9, 0.5],
			[1, 0.4]
		];
		for (const [g, s] of offers) forward.offer(g, s, g);
		for (const [g, s] of [...offers].reverse()) backward.offer(g, s, g);
		expect(forward.groups().map((g) => g.group)).toEqual([3, 5]);
		expect(backward.groups().map((g) => g.group)).toEqual([3, 5]);
	});

	it('lets an evicted group come back with a better passage', () => {
		const heap = new GroupHeap(2);
		heap.offer(1, 0.3, 10);
		heap.offer(2, 0.5, 20);
		heap.offer(3, 0.6, 30);
		expect(heap.groups().map((g) => g.group)).toEqual([3, 2]);
		heap.offer(1, 0.9, 11);
		expect(heap.groups().map((g) => [g.group, g.score])).toEqual([
			[1, 0.9],
			[3, 0.6]
		]);
		expect(heap.threshold()).toBe(0.6);
	});

	it('holds the best few passages of each group', () => {
		const heap = new GroupHeap(4, 3);
		for (const [item, score] of [
			[1, 0.1],
			[2, 0.7],
			[3, 0.4],
			[4, 0.9],
			[5, 0.2]
		]) {
			heap.offer(8, score, item);
		}
		expect(heap.groups()[0].items).toEqual([
			{ item: 4, score: 0.9 },
			{ item: 2, score: 0.7 },
			{ item: 3, score: 0.4 }
		]);
	});
});
