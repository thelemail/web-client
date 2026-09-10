import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8 } from './bytes';

const SUITE = concatBytes(new Uint8Array([0xff]), utf8('c2sp.org/vrf-r255'));
const ENCODE_TO_CURVE_DS = 0x82;
const CHALLENGE_FRONT = 0x02;
const CHALLENGE_BACK = 0x00;
const PROOF_TO_HASH_FRONT = 0x03;
const PROOF_TO_HASH_BACK = 0x00;

const Point = ristretto255.Point;
const ORDER = Point.Fn.ORDER;

function scalarFromLE(bytes: Uint8Array): bigint {
	let v = 0n;
	for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
	return v;
}

export function vrfVerify(
	publicKey: Uint8Array,
	pi: Uint8Array,
	alpha: Uint8Array
): Uint8Array | null {
	if (publicKey.length !== 32 || pi.length !== 80) return null;
	try {
		const Y = Point.fromBytes(publicKey);
		const gamma = Point.fromBytes(pi.slice(0, 32));
		const cBytes = pi.slice(32, 48);
		const c = scalarFromLE(cBytes);
		const s = scalarFromLE(pi.slice(48, 80));
		if (s >= ORDER) return null;
		const H = ristretto255_hasher.deriveToCurve!(
			sha512(concatBytes(SUITE, new Uint8Array([ENCODE_TO_CURVE_DS]), publicKey, alpha))
		);
		const U = Point.BASE.multiplyUnsafe(s).subtract(Y.multiplyUnsafe(c));
		const V = H.multiplyUnsafe(s).subtract(gamma.multiplyUnsafe(c));
		const challenge = sha512(
			concatBytes(
				SUITE,
				new Uint8Array([CHALLENGE_FRONT]),
				Y.toBytes(),
				H.toBytes(),
				gamma.toBytes(),
				U.toBytes(),
				V.toBytes(),
				new Uint8Array([CHALLENGE_BACK])
			)
		);
		for (let i = 0; i < 16; i++) {
			if (challenge[i] !== cBytes[i]) return null;
		}
		return sha512(
			concatBytes(
				SUITE,
				new Uint8Array([PROOF_TO_HASH_FRONT]),
				gamma.toBytes(),
				new Uint8Array([PROOF_TO_HASH_BACK])
			)
		);
	} catch {
		return null;
	}
}
