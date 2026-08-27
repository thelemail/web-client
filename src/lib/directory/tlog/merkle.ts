import { sha256 } from '@noble/hashes/sha2.js';
import { bytesEqual, concatBytes } from './bytes';

export function leafHash(entry: Uint8Array): Uint8Array {
	return sha256(concatBytes(new Uint8Array([0x00]), entry));
}

function nodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
	return sha256(concatBytes(new Uint8Array([0x01]), left, right));
}

export function verifyInclusion(
	index: bigint,
	treeSize: bigint,
	leaf: Uint8Array,
	path: Uint8Array[],
	rootHash: Uint8Array
): boolean {
	if (index < 0n || index >= treeSize) return false;
	let fn = index;
	let sn = treeSize - 1n;
	let hash = leaf;
	for (const sibling of path) {
		if (sn === 0n) return false;
		if ((fn & 1n) === 1n || fn === sn) {
			hash = nodeHash(sibling, hash);
			if ((fn & 1n) === 0n) {
				while (true) {
					fn >>= 1n;
					sn >>= 1n;
					if ((fn & 1n) === 1n || fn === 0n) break;
				}
			}
		} else {
			hash = nodeHash(hash, sibling);
		}
		fn >>= 1n;
		sn >>= 1n;
	}
	return sn === 0n && bytesEqual(hash, rootHash);
}
