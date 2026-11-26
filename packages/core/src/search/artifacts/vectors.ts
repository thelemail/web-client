import type { Database } from '@thelemail/sqlite-wasm';
import { DIMENSIONS, VECTOR_BYTES, decodeHalf } from '../model/pool';
import type { EmbeddedPassage } from '../model/protocol';
import { RECIPE } from '../model/recipe';
import type { Field } from '../sqlite/types';

export const VECTORS_VERSION = 1;
const MAX_LABEL = 256;
const MAX_PARTS = 100_000;
const NORM_TOLERANCE = 0.01;
const DIGEST = /^[0-9a-f]{64}$/;

export class VectorsError extends Error {}

export interface PortableRef {
	part: number;
	start: number;
	end: number;
}

export interface PortablePassage {
	field: Field;
	attachmentId: string | null;
	place: string | null;
	refs: PortableRef[];
	vector: Uint8Array;
}

export interface VectorsPayload {
	epoch: number;
	parts: number;
	digest: string;
	passages: PortablePassage[];
}

export interface LocalPart {
	id: number;
	field: Field;
	text: string;
}

type Wire = {
	v: number;
	e: number;
	n: number;
	h: string;
	p: [number, string | null, string | null, [number, number, number][]][];
};

export function localParts(db: Database, source: number): LocalPart[] {
	return (db.selectArrays(`SELECT id, field, text FROM parts WHERE source = ? AND field IN (${RECIPE.fields.join(', ')}) ORDER BY id`, [source]) as [number, number, string][]).map(
		([id, field, text]) => ({ id, field: field as Field, text })
	);
}

export async function partsDigest(parts: readonly LocalPart[]): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(parts.map((p) => [p.field, p.text])));
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readVectors(db: Database, epoch: number, source: number): Promise<VectorsPayload | null> {
	const parts = localParts(db, source);
	const index = new Map(parts.map((p, i) => [p.id, i]));
	const rows = db.selectArrays('SELECT ordinal, field, attachment_id, place, vector FROM passages WHERE epoch = ? AND source = ? ORDER BY ordinal', [epoch, source]) as [
		number,
		number,
		string | null,
		string | null,
		Uint8Array
	][];
	const refs = new Map<number, PortableRef[]>();
	for (const [ordinal, part, start, end] of db.selectArrays('SELECT ordinal, part, start, end FROM passage_refs WHERE epoch = ? AND source = ? ORDER BY ordinal, part, start', [
		epoch,
		source
	]) as [number, number, number, number][]) {
		const at = index.get(part);
		if (at === undefined) return null;
		if (!refs.has(ordinal)) refs.set(ordinal, []);
		refs.get(ordinal)!.push({ part: at, start, end });
	}
	return {
		epoch,
		parts: parts.length,
		digest: await partsDigest(parts),
		passages: rows.map(([ordinal, field, attachmentId, place, vector]) => ({ field: field as Field, attachmentId, place, refs: refs.get(ordinal) ?? [], vector }))
	};
}

export function encodeVectors(p: VectorsPayload): Uint8Array {
	const wire: Wire = {
		v: VECTORS_VERSION,
		e: p.epoch,
		n: p.parts,
		h: p.digest,
		p: p.passages.map((x) => [x.field, x.attachmentId, x.place, x.refs.map((r) => [r.part, r.start, r.end])])
	};
	const json = new TextEncoder().encode(JSON.stringify(wire));
	const out = new Uint8Array(4 + json.length + p.passages.length * VECTOR_BYTES);
	new DataView(out.buffer).setUint32(0, json.length);
	out.set(json, 4);
	p.passages.forEach((x, i) => out.set(x.vector, 4 + json.length + i * VECTOR_BYTES));
	return out;
}

function count(v: unknown, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) throw new VectorsError('number');
	return v;
}

function label(v: unknown): string | null {
	if (v === null) return null;
	if (typeof v !== 'string' || v.length > MAX_LABEL) throw new VectorsError('label');
	return v;
}

function unit(bytes: Uint8Array): Uint8Array {
	const v = decodeHalf(bytes);
	let sum = 0;
	for (let d = 0; d < DIMENSIONS; d++) {
		if (!Number.isFinite(v[d])) throw new VectorsError('vector');
		sum += v[d] * v[d];
	}
	if (Math.abs(Math.sqrt(sum) - 1) > NORM_TOLERANCE) throw new VectorsError('vector');
	return bytes;
}

export function decodeVectors(bytes: Uint8Array): VectorsPayload {
	if (bytes.length < 4) throw new VectorsError('short');
	const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
	if (length > bytes.length - 4) throw new VectorsError('short');
	let wire: Wire;
	try {
		wire = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + length))) as Wire;
	} catch {
		throw new VectorsError('json');
	}
	if (!wire || typeof wire !== 'object' || wire.v !== VECTORS_VERSION) throw new VectorsError('version');
	const epoch = count(wire.e);
	const parts = count(wire.n, MAX_PARTS);
	if (typeof wire.h !== 'string' || !DIGEST.test(wire.h)) throw new VectorsError('digest');
	if (!Array.isArray(wire.p) || wire.p.length > RECIPE.maxPassages) throw new VectorsError('passages');
	const body = bytes.subarray(4 + length);
	if (body.length !== wire.p.length * VECTOR_BYTES) throw new VectorsError('vectors');
	const passages = wire.p.map((entry, i): PortablePassage => {
		if (!Array.isArray(entry) || entry.length !== 4 || !Array.isArray(entry[3])) throw new VectorsError('passage');
		const field = count(entry[0]) as Field;
		if (!RECIPE.fields.includes(field)) throw new VectorsError('field');
		const refs = entry[3].map((r): PortableRef => {
			if (!Array.isArray(r) || r.length !== 3) throw new VectorsError('ref');
			const part = count(r[0], parts - 1);
			const start = count(r[1]);
			const end = count(r[2]);
			if (end < start) throw new VectorsError('ref');
			return { part, start, end };
		});
		return { field, attachmentId: label(entry[1]), place: label(entry[2]), refs, vector: unit(body.slice(i * VECTOR_BYTES, (i + 1) * VECTOR_BYTES)) };
	});
	return { epoch, parts, digest: wire.h, passages };
}

export function toLocal(payload: VectorsPayload, parts: readonly LocalPart[]): EmbeddedPassage[] | null {
	if (payload.parts !== parts.length) return null;
	const out: EmbeddedPassage[] = [];
	for (const p of payload.passages) {
		const refs = [];
		for (const r of p.refs) {
			const part = parts[r.part];
			if (!part || r.end > part.text.length) return null;
			refs.push({ part: part.id, start: r.start, end: r.end });
		}
		out.push({ field: p.field, attachmentId: p.attachmentId, place: p.place, refs, vector: decodeHalf(p.vector) });
	}
	return out;
}
