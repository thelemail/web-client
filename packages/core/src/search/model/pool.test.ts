import { describe, expect, it } from 'vitest';
import { decodeHalf, DIMENSIONS, encodeHalf, fromHalf, meanPool, normalized, toHalf } from './pool';

describe('fp16', () => {
	it('encodes reference values', () => {
		expect(toHalf(0)).toBe(0x0000);
		expect(toHalf(-0)).toBe(0x8000);
		expect(toHalf(1)).toBe(0x3c00);
		expect(toHalf(-2)).toBe(0xc000);
		expect(toHalf(65504)).toBe(0x7bff);
		expect(toHalf(65520)).toBe(0x7c00);
		expect(toHalf(2 ** -24)).toBe(0x0001);
		expect(toHalf(2 ** -14)).toBe(0x0400);
		expect(toHalf(Infinity)).toBe(0x7c00);
		expect(toHalf(NaN) & 0x7c00).toBe(0x7c00);
		expect(toHalf(1 + 2 ** -11)).toBe(0x3c00);
		expect(toHalf(1 + 3 * 2 ** -11)).toBe(0x3c02);
	});

	it('round-trips unit-vector components within half precision', () => {
		for (let i = 0; i < 2000; i++) {
			const x = Math.sin(i) * 0.3;
			expect(Math.abs(fromHalf(toHalf(x)) - x)).toBeLessThanOrEqual(Math.abs(x) * 2 ** -11 + 2 ** -25);
		}
	});

	it('packs vectors little-endian', () => {
		const v = new Float32Array([1, -2, 0.5]);
		const bytes = encodeHalf(v);
		expect(Array.from(bytes)).toEqual([0x00, 0x3c, 0x00, 0xc0, 0x00, 0x38]);
		expect(Array.from(decodeHalf(bytes))).toEqual([1, -2, 0.5]);
	});
});

describe('pooling', () => {
	it('averages over unmasked tokens', () => {
		const hidden = new Float32Array(3 * DIMENSIONS);
		hidden.fill(1, 0, DIMENSIONS);
		hidden.fill(3, DIMENSIONS, 2 * DIMENSIONS);
		hidden.fill(100, 2 * DIMENSIONS);
		const v = meanPool(hidden, 3, [1, 1, 0]);
		expect(v[0]).toBe(2);
		expect(v[DIMENSIONS - 1]).toBe(2);
	});

	it('normalizes to unit length and rejects zero or non-finite vectors', () => {
		const v = normalized(new Float32Array([3, 4]));
		expect(Array.from(v!)).toEqual([0.6000000238418579, 0.800000011920929]);
		expect(normalized(new Float32Array([0, 0]))).toBeNull();
		expect(normalized(new Float32Array([1, NaN]))).toBeNull();
		expect(normalized(new Float32Array([1, Infinity]))).toBeNull();
	});
});
