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

export function verifyConsistency(
	oldSize: bigint,
	oldRoot: Uint8Array,
	newSize: bigint,
	newRoot: Uint8Array,
	proof: Uint8Array[]
): boolean {
	if (oldSize < 1n || oldSize >= newSize) return false;
	const path = (oldSize & (oldSize - 1n)) === 0n ? [oldRoot, ...proof] : proof;
	if (path.length === 0) return false;
	let fn = oldSize - 1n;
	let sn = newSize - 1n;
	while ((fn & 1n) === 1n) {
		fn >>= 1n;
		sn >>= 1n;
	}
	let fr = path[0];
	let sr = path[0];
	for (const c of path.slice(1)) {
		if (sn === 0n) return false;
		if ((fn & 1n) === 1n || fn === sn) {
			fr = nodeHash(c, fr);
			sr = nodeHash(c, sr);
			if ((fn & 1n) === 0n) {
				while (true) {
					fn >>= 1n;
					sn >>= 1n;
					if ((fn & 1n) === 1n || fn === 0n) break;
				}
			}
		} else {
			sr = nodeHash(sr, c);
		}
		fn >>= 1n;
		sn >>= 1n;
	}
	return sn === 0n && bytesEqual(fr, oldRoot) && bytesEqual(sr, newRoot);
}
