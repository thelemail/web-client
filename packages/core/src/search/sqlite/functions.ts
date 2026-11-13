import type { Database, SqlValue } from '@thelemail/sqlite-wasm';
import { foldText } from '../query/text';

const WORD = '[\\p{L}\\p{N}\\p{M}]';
const JOINER = '[-/_.#:@+]';
const BOUNDED = new Map<string, RegExp>();
const BOUNDED_CACHE = 64;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function boundedPattern(needle: string): RegExp {
	let re = BOUNDED.get(needle);
	if (!re) {
		re = new RegExp(`(?<!${WORD})(?<!${WORD}${JOINER})${escapeRegExp(needle)}(?!${WORD})(?!${JOINER}${WORD})`, 'u');
		if (BOUNDED.size >= BOUNDED_CACHE) BOUNDED.delete(BOUNDED.keys().next().value as string);
		BOUNDED.set(needle, re);
	}
	return re;
}

export function bounded(text: string | null, needle: string): boolean {
	if (!text || !needle) return false;
	const folded = foldText(text);
	return folded.includes(needle) && boundedPattern(needle).test(folded);
}

export function significant(value: number): number {
	return value === 0 ? 0 : Number(value.toPrecision(12));
}

export function extension(filename: string): string {
	const folded = foldText(filename);
	const dot = folded.lastIndexOf('.');
	return dot > 0 && dot < folded.length - 1 ? folded.slice(dot + 1) : '';
}

export function compareCodePoints(a: string, b: string): number {
	const x = [...a];
	const y = [...b];
	const n = Math.min(x.length, y.length);
	for (let i = 0; i < n; i++) {
		const d = (x[i].codePointAt(0) as number) - (y[i].codePointAt(0) as number);
		if (d !== 0) return d < 0 ? -1 : 1;
	}
	return x.length === y.length ? 0 : x.length < y.length ? -1 : 1;
}

export function editDistance(a: readonly string[], b: readonly string[], max: number): number {
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const row = [i];
		let best = i;
		for (let j = 1; j <= b.length; j++) {
			const value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			row.push(value);
			if (value < best) best = value;
		}
		if (best > max) return max + 1;
		prev = row;
	}
	return prev[b.length];
}

export function registerFunctions(db: Database): void {
	const options = { deterministic: true, innocuous: true } as const;
	const text = (value: SqlValue) => (typeof value === 'string' ? value : null);
	db.createFunction('tl_bounded', (_ctx, value, needle) => (bounded(text(value), text(needle) ?? '') ? 1 : 0), { ...options, arity: 2 });
	db.createFunction('tl_fold', (_ctx, value) => (typeof value === 'string' ? foldText(value) : null), { ...options, arity: 1 });
	db.createFunction('tl_ext', (_ctx, value) => (typeof value === 'string' ? extension(value) : null), { ...options, arity: 1 });
	db.createFunction('tl_sig', (_ctx, value) => significant(Number(value)), { ...options, arity: 1 });
}
