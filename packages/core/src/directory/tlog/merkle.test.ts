import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import { concatBytes, utf8 } from './bytes';
import { leafHash, verifyInclusion } from './merkle';

function node(left: Uint8Array, right: Uint8Array): Uint8Array {
	return sha256(concatBytes(new Uint8Array([0x01]), left, right));
}

const l0 = leafHash(utf8('leaf-0'));
const l1 = leafHash(utf8('leaf-1'));
const l2 = leafHash(utf8('leaf-2'));
const h01 = node(l0, l1);
const root3 = node(h01, l2);

describe('verifyInclusion', () => {
	it('verifies every leaf of a three-leaf tree', () => {
		expect(verifyInclusion(0n, 3n, l0, [l1, l2], root3)).toBe(true);
		expect(verifyInclusion(1n, 3n, l1, [l0, l2], root3)).toBe(true);
		expect(verifyInclusion(2n, 3n, l2, [h01], root3)).toBe(true);
	});

	it('verifies a single-leaf tree with an empty path', () => {
		expect(verifyInclusion(0n, 1n, l0, [], l0)).toBe(true);
	});

	it('rejects a wrong root', () => {
		expect(verifyInclusion(0n, 3n, l0, [l1, l2], h01)).toBe(false);
	});

	it('rejects a wrong index', () => {
		expect(verifyInclusion(1n, 3n, l0, [l1, l2], root3)).toBe(false);
	});

	it('rejects an out-of-range index', () => {
		expect(verifyInclusion(3n, 3n, l2, [h01], root3)).toBe(false);
	});

	it('rejects a path of the wrong length', () => {
		expect(verifyInclusion(0n, 3n, l0, [l1], root3)).toBe(false);
		expect(verifyInclusion(2n, 3n, l2, [h01, l0], root3)).toBe(false);
	});

	it('rejects a swapped sibling order', () => {
		expect(verifyInclusion(0n, 3n, l0, [l2, l1], root3)).toBe(false);
	});
});
