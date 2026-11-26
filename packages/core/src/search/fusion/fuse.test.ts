import { describe, expect, it } from 'vitest';
import { RRF_K, fuse } from './fuse';

const r = (key: string, date = 0, tier = 0) => ({ key, date, tier });

describe('fuse', () => {
	it('adds reciprocal ranks and labels each channel', () => {
		const out = fuse([r('a'), r('b')], [r('b'), r('c')], 10);
		const by = Object.fromEntries(out.map((f) => [f.key, f]));
		expect(by.a.score).toBeCloseTo(1 / (RRF_K + 1));
		expect(by.b.score).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1));
		expect(by.c.score).toBeCloseTo(1 / (RRF_K + 2));
		expect([by.a.channel, by.b.channel, by.c.channel]).toEqual(['words', 'both', 'meaning']);
		expect(out.map((f) => f.key)).toEqual(['b', 'a', 'c']);
	});

	it('gives a missing rank nothing', () => {
		const [only] = fuse([], [r('x')], 10);
		expect(only).toMatchObject({ lexical: null, semantic: 1, channel: 'meaning' });
	});

	it('puts the priority tier before any fused score', () => {
		const out = fuse([r('a'), r('b'), r('t', 0, 1)], [r('a'), r('b')], 10);
		expect(out[0].key).toBe('t');
	});

	it('breaks ties on newer date, then on key', () => {
		const out = fuse([r('b', 1), r('a', 5)], [r('a', 5), r('b', 1)], 10);
		expect(out.map((f) => f.key)).toEqual(['a', 'b']);
		const same = fuse([r('z', 3)], [r('y', 3)], 10);
		expect(same.map((f) => f.key)).toEqual(['y', 'z']);
	});

	it('ignores a repeated key within one channel and keeps the limit', () => {
		const out = fuse([r('a'), r('a'), r('b')], [r('c')], 2);
		expect(out).toHaveLength(2);
		expect(out.find((f) => f.key === 'a')?.lexical).toBe(1);
	});
});
