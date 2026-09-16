import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import { concatBytes, utf8 } from './bytes';
import { leafHash, verifyConsistency, verifyInclusion } from './merkle';

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

function largestPowerOfTwoBelow(n: number): number {
	let k = 1;
	while (k * 2 < n) k *= 2;
	return k;
}

function mth(leaves: Uint8Array[]): Uint8Array {
	if (leaves.length === 1) return leaves[0];
	const k = largestPowerOfTwoBelow(leaves.length);
	return node(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

function subproof(m: number, leaves: Uint8Array[], complete: boolean): Uint8Array[] {
	const n = leaves.length;
	if (m === n) return complete ? [] : [mth(leaves)];
	const k = largestPowerOfTwoBelow(n);
	if (m <= k) return [...subproof(m, leaves.slice(0, k), complete), mth(leaves.slice(k))];
	return [...subproof(m - k, leaves.slice(k), false), mth(leaves.slice(0, k))];
}

const leaves = Array.from({ length: 12 }, (_, i) => leafHash(utf8(`leaf-${i}`)));

describe('verifyConsistency', () => {
	it('verifies every size pair of a twelve-leaf log', () => {
		for (let m = 1; m <= 12; m++) {
			for (let n = m + 1; n <= 12; n++) {
				const proof = subproof(m, leaves.slice(0, n), true);
				expect(
					verifyConsistency(BigInt(m), mth(leaves.slice(0, m)), BigInt(n), mth(leaves.slice(0, n)), proof),
					`${m} -> ${n}`
				).toBe(true);
			}
		}
	});

	it('rejects a corrupted proof hash at every position', () => {
		const proof = subproof(5, leaves.slice(0, 11), true);
		const oldRoot = mth(leaves.slice(0, 5));
		const newRoot = mth(leaves.slice(0, 11));
		for (let i = 0; i < proof.length; i++) {
			const bad = proof.map((h) => h.slice());
			bad[i][0] ^= 1;
			expect(verifyConsistency(5n, oldRoot, 11n, newRoot, bad)).toBe(false);
		}
	});

	it('rejects a forked log that shares a prefix', () => {
		const forked = [...leaves.slice(0, 6), leafHash(utf8('other')), ...leaves.slice(7)];
		const proof = subproof(7, forked.slice(0, 10), true);
		expect(
			verifyConsistency(7n, mth(leaves.slice(0, 7)), 10n, mth(forked.slice(0, 10)), proof)
		).toBe(false);
	});

	it('rejects wrong sizes, empty proofs and truncated or padded proofs', () => {
		const oldRoot = mth(leaves.slice(0, 6));
		const newRoot = mth(leaves.slice(0, 9));
		const proof = subproof(6, leaves.slice(0, 9), true);
		expect(verifyConsistency(6n, oldRoot, 9n, newRoot, proof)).toBe(true);
		expect(verifyConsistency(5n, oldRoot, 9n, newRoot, proof)).toBe(false);
		expect(verifyConsistency(6n, oldRoot, 9n, newRoot, [])).toBe(false);
		expect(verifyConsistency(6n, oldRoot, 9n, newRoot, proof.slice(1))).toBe(false);
		expect(verifyConsistency(6n, oldRoot, 9n, newRoot, [...proof, proof[0]])).toBe(false);
		expect(verifyConsistency(9n, newRoot, 9n, newRoot, [])).toBe(false);
		expect(verifyConsistency(0n, oldRoot, 9n, newRoot, proof)).toBe(false);
		expect(verifyConsistency(9n, newRoot, 6n, oldRoot, proof)).toBe(false);
	});

	it('rejects swapped roots', () => {
		const oldRoot = mth(leaves.slice(0, 4));
		const newRoot = mth(leaves.slice(0, 8));
		const proof = subproof(4, leaves.slice(0, 8), true);
		expect(verifyConsistency(4n, oldRoot, 8n, newRoot, proof)).toBe(true);
		expect(verifyConsistency(4n, newRoot, 8n, oldRoot, proof)).toBe(false);
	});
});
