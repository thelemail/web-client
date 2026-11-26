// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DIMENSIONS, encodeHalf } from '../model/pool';
import { Field } from '../sqlite/types';
import { VectorsError, decodeVectors, encodeVectors, toLocal, type LocalPart, type VectorsPayload } from './vectors';

function unit(seed: number): Float32Array {
	const v = new Float32Array(DIMENSIONS);
	let sum = 0;
	for (let d = 0; d < DIMENSIONS; d++) {
		v[d] = Math.sin(seed * 31 + d);
		sum += v[d] * v[d];
	}
	for (let d = 0; d < DIMENSIONS; d++) v[d] /= Math.sqrt(sum);
	return v;
}

const DIGEST = 'a'.repeat(64);
const PARTS: LocalPart[] = [
	{ id: 41, field: Field.body, text: 'The ferry leaves at nine.' },
	{ id: 44, field: Field.attachmentText, text: 'Timetable page one.' }
];

function payload(overrides: Partial<VectorsPayload> = {}): VectorsPayload {
	return {
		epoch: 123_456_789,
		parts: 2,
		digest: DIGEST,
		passages: [
			{ field: Field.body, attachmentId: null, place: null, refs: [{ part: 0, start: 0, end: 25 }], vector: encodeHalf(unit(1)) },
			{ field: Field.attachmentText, attachmentId: 'att-1', place: 'page:1', refs: [{ part: 1, start: 0, end: 19 }], vector: encodeHalf(unit(2)) }
		],
		...overrides
	};
}

function reencoded(p: VectorsPayload, change: (wire: Record<string, unknown>) => void): Uint8Array {
	const bytes = encodeVectors(p);
	const length = new DataView(bytes.buffer).getUint32(0);
	const wire = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + length))) as Record<string, unknown>;
	change(wire);
	const json = new TextEncoder().encode(JSON.stringify(wire));
	const out = new Uint8Array(4 + json.length + bytes.length - 4 - length);
	new DataView(out.buffer).setUint32(0, json.length);
	out.set(json, 4);
	out.set(bytes.subarray(4 + length), 4 + json.length);
	return out;
}

describe('vectors payload', () => {
	it('round-trips passages, spans and fp16 vectors exactly', () => {
		const p = payload();
		const back = decodeVectors(encodeVectors(p));
		expect(back).toEqual(p);
		const local = toLocal(back, PARTS)!;
		expect(local.map((x) => x.refs)).toEqual([[{ part: 41, start: 0, end: 25 }], [{ part: 44, start: 0, end: 19 }]]);
		expect(encodeHalf(local[1].vector)).toEqual(p.passages[1].vector);
	});

	it('keeps a message with no passages', () => {
		expect(decodeVectors(encodeVectors(payload({ passages: [] }))).passages).toEqual([]);
	});

	it.each([
		['another version', (w: Record<string, unknown>) => (w.v = 2)],
		['a part outside the message', (w: Record<string, unknown>) => ((w.p as unknown[][])[0][3] = [[2, 0, 5]])],
		['a span that ends before it starts', (w: Record<string, unknown>) => ((w.p as unknown[][])[0][3] = [[0, 9, 3]])],
		['a field that is never embedded', (w: Record<string, unknown>) => ((w.p as unknown[][])[0][0] = Field.subject)],
		['a malformed digest', (w: Record<string, unknown>) => (w.h = 'xyz')],
		['a fractional epoch', (w: Record<string, unknown>) => (w.e = 1.5)]
	])('rejects %s', (_name, change) => {
		expect(() => decodeVectors(reencoded(payload(), change))).toThrow(VectorsError);
	});

	it('rejects truncated, padded and non-unit vectors', () => {
		const bytes = encodeVectors(payload());
		expect(() => decodeVectors(bytes.subarray(0, bytes.length - 2))).toThrow(VectorsError);
		const longer = new Uint8Array(bytes.length + 2);
		longer.set(bytes);
		expect(() => decodeVectors(longer)).toThrow(VectorsError);
		const scaled = unit(3).map((x) => x * 2);
		expect(() => decodeVectors(encodeVectors(payload({ passages: [{ ...payload().passages[0], vector: encodeHalf(scaled) }] })))).toThrow(VectorsError);
		const nan = unit(4);
		nan[7] = Number.NaN;
		expect(() => decodeVectors(encodeVectors(payload({ passages: [{ ...payload().passages[0], vector: encodeHalf(nan) }] })))).toThrow(VectorsError);
	});

	it('refuses to map onto parts that do not match', () => {
		const p = decodeVectors(encodeVectors(payload()));
		expect(toLocal(p, PARTS.slice(0, 1))).toBeNull();
		expect(toLocal(p, [PARTS[0], { ...PARTS[1], text: 'short' }])).toBeNull();
	});
});
