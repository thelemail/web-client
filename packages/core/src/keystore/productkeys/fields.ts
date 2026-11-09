import type { Json } from './canonical';
import { MAX_SAFE } from './canonical';
import { b64decode, compareBytes, requireUuid } from './encoding';
import { fail } from './errors';

export type Obj = { [key: string]: Json };

export const MAX_RECORD_BYTES = 1 << 20;
export const HASH_LEN = 32;

const NULLABLE = new Set([
	'ciphertextHash',
	'material',
	'migrationId',
	'minimumWriteProfile',
	'previousDelegationHash',
	'previousHeadHash',
	'previousManifestHash',
	'previousPageHash'
]);

export function exact(o: Json, fields: readonly string[]): Obj {
	if (o === null || typeof o !== 'object' || Array.isArray(o)) fail('malformed', 'not an object');
	const keys = Object.keys(o);
	if (keys.length !== fields.length) fail('malformed', 'unexpected fields');
	for (const f of fields) {
		if (!(f in o)) fail('malformed', `missing ${f}`);
		if (o[f] === null && !NULLABLE.has(f)) fail('malformed', `${f} is null`);
	}
	return o;
}

export function array(o: Obj, key: string): Json[] {
	const v = o[key];
	if (!Array.isArray(v)) fail('malformed', `${key} is not an array`);
	return v;
}

export function str(o: Obj, key: string): string {
	const v = o[key];
	if (typeof v !== 'string') fail('malformed', `${key} is not a string`);
	return v;
}

export function bool(o: Obj, key: string): boolean {
	const v = o[key];
	if (typeof v !== 'boolean') fail('malformed', `${key} is not a boolean`);
	return v;
}

export function int(o: Obj, key: string, min = 0): number {
	const v = o[key];
	if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > MAX_SAFE) {
		fail('malformed', `${key} out of range`);
	}
	return v;
}

export function id(o: Obj, key: string): string {
	return requireUuid(o[key]);
}

export function bin(o: Obj, key: string, len?: number): Uint8Array {
	const b = b64decode(o[key]);
	if (len !== undefined && b.length !== len) fail('malformed', `${key} length`);
	return b;
}

export function optBin(o: Obj, key: string, len?: number): Uint8Array | null {
	return o[key] === null ? null : bin(o, key, len);
}

export function hash(o: Obj, key: string): Uint8Array {
	return bin(o, key, HASH_LEN);
}

export function chainLink(o: Obj, key: string, revision: number): Uint8Array | null {
	const prev = optBin(o, key, HASH_LEN);
	if ((revision === 1) !== (prev === null)) fail('malformed', `${key} does not match revision`);
	return prev;
}

export function profileId(o: Obj, key: string): string {
	const s = str(o, key);
	if (s.length < 1 || s.length > 128) fail('malformed', `${key} length`);
	return s;
}

export function timestamp(o: Obj, key: string): string {
	const s = str(o, key);
	const d = new Date(s);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().replace('.000Z', 'Z') !== s) {
		fail('malformed', 'noncanonical timestamp');
	}
	return s;
}

export function formatTime(d: Date): string {
	return new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}

export function sortedUnique<T>(items: T[], key: (t: T) => Uint8Array | string): void {
	for (let i = 1; i < items.length; i++) {
		const a = key(items[i - 1]);
		const b = key(items[i]);
		const c = typeof a === 'string' && typeof b === 'string' ? (a < b ? -1 : a > b ? 1 : 0) : compareBytes(a as Uint8Array, b as Uint8Array);
		if (c >= 0) fail('malformed', 'entries are not sorted or repeat');
	}
}

export function tupleKey(...parts: string[]): string {
	return parts.map((p) => `${p}\u0000`).join('');
}

export function revisionKey(n: number): string {
	return String(n).padStart(16, '0');
}
