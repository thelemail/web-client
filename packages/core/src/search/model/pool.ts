export const DIMENSIONS = 384;
export const VECTOR_BYTES = DIMENSIONS * 2;

export function meanPool(hidden: Float32Array, tokens: number, mask?: ArrayLike<number | bigint>): Float32Array {
	if (hidden.length !== tokens * DIMENSIONS) throw new RangeError('hidden state shape');
	const out = new Float32Array(DIMENSIONS);
	let count = 0;
	for (let t = 0; t < tokens; t++) {
		if (mask && !Number(mask[t])) continue;
		count++;
		const row = t * DIMENSIONS;
		for (let d = 0; d < DIMENSIONS; d++) out[d] += hidden[row + d];
	}
	if (count === 0) throw new RangeError('empty attention mask');
	for (let d = 0; d < DIMENSIONS; d++) out[d] /= count;
	return out;
}

export function normalized(v: Float32Array): Float32Array | null {
	let sum = 0;
	for (let d = 0; d < v.length; d++) {
		if (!Number.isFinite(v[d])) return null;
		sum += v[d] * v[d];
	}
	const norm = Math.sqrt(sum);
	if (!Number.isFinite(norm) || norm === 0) return null;
	const out = new Float32Array(v.length);
	for (let d = 0; d < v.length; d++) out[d] = v[d] / norm;
	return out;
}

const scratch = new Float32Array(1);
const bits = new Uint32Array(scratch.buffer);

export function toHalf(value: number): number {
	scratch[0] = value;
	const x = bits[0];
	const sign = (x >>> 16) & 0x8000;
	const exp = (x >>> 23) & 0xff;
	let mant = x & 0x7fffff;
	if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
	let e = exp - 127 + 15;
	if (e >= 0x1f) return sign | 0x7c00;
	if (e <= 0) {
		if (e < -10) return sign;
		mant |= 0x800000;
		const shift = 14 - e;
		const half = 1 << (shift - 1);
		let m = mant >>> shift;
		const rest = mant & ((1 << shift) - 1);
		if (rest > half || (rest === half && m & 1)) m++;
		return sign | m;
	}
	let m = mant >>> 13;
	const rest = mant & 0x1fff;
	if (rest > 0x1000 || (rest === 0x1000 && m & 1)) {
		m++;
		if (m === 0x400) {
			m = 0;
			e++;
			if (e >= 0x1f) return sign | 0x7c00;
		}
	}
	return sign | (e << 10) | m;
}

export function fromHalf(h: number): number {
	const sign = h & 0x8000 ? -1 : 1;
	const exp = (h >>> 10) & 0x1f;
	const mant = h & 0x3ff;
	if (exp === 0) return sign * mant * 2 ** -24;
	if (exp === 0x1f) return mant ? NaN : sign * Infinity;
	return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

export function encodeHalf(v: Float32Array): Uint8Array {
	const out = new Uint8Array(v.length * 2);
	const view = new DataView(out.buffer);
	for (let d = 0; d < v.length; d++) view.setUint16(d * 2, toHalf(v[d]), true);
	return out;
}

export function decodeHalf(bytes: Uint8Array): Float32Array {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const out = new Float32Array(bytes.byteLength / 2);
	for (let d = 0; d < out.length; d++) out[d] = fromHalf(view.getUint16(d * 2, true));
	return out;
}
