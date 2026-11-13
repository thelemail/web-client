import type { Database } from '@thelemail/sqlite-wasm';
import type { Range } from '../query/ast';
import type { Suggestible } from './compile';
import { compareCodePoints, editDistance } from './functions';
import type { Tokenizer } from './tokenizer';

export const MAX_SUGGESTIONS = 8;
const VOCAB_SLICE = 4096;

export interface Suggestion {
	range: Range;
	original: string;
	replacement: string;
}

interface Target {
	term: Suggestible;
	token: string;
	chars: string[];
	max: number;
}

interface Candidate {
	target: Target;
	replacement: string;
	distance: number;
	documents: number;
}

export function allowedEdits(length: number): number {
	if (length >= 4 && length <= 7) return 1;
	if (length >= 8 && length <= 32) return 2;
	return 0;
}

function better(a: Candidate, b: Candidate): number {
	return a.distance - b.distance || b.documents - a.documents || compareCodePoints(a.replacement, b.replacement) || a.target.term.range.start - b.target.term.range.start;
}

export async function suggest(
	db: Database,
	tokenizer: Tokenizer,
	terms: readonly Suggestible[],
	checkpoint: () => Promise<void>
): Promise<Suggestion[]> {
	db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS temp.tl_vocab USING fts5vocab (main, parts_fts, row)');
	const targets: Target[] = [];
	for (const term of terms) {
		const tokens = tokenizer.tokens(term.text);
		if (tokens.length !== 1) continue;
		const chars = [...tokens[0]];
		const max = allowedEdits(chars.length);
		if (!max) continue;
		if (db.selectValue('SELECT doc FROM temp.tl_vocab WHERE term = ?', [tokens[0]])) continue;
		targets.push({ term, token: tokens[0], chars, max });
	}
	if (!targets.length) return [];
	const found: Candidate[] = [];
	let after = '';
	for (;;) {
		await checkpoint();
		const rows = db.selectArrays('SELECT term, doc FROM temp.tl_vocab WHERE term > ? ORDER BY term LIMIT ?', [after, VOCAB_SLICE]);
		if (!rows.length) break;
		for (const [term, doc] of rows as [string, number][]) {
			const chars = [...term];
			for (const target of targets) {
				if (Math.abs(chars.length - target.chars.length) > target.max) continue;
				const distance = editDistance(target.chars, chars, target.max);
				if (distance > 0 && distance <= target.max) found.push({ target, replacement: term, distance, documents: doc });
			}
		}
		after = rows[rows.length - 1][0] as string;
		if (rows.length < VOCAB_SLICE) break;
	}
	return found
		.sort(better)
		.slice(0, MAX_SUGGESTIONS)
		.map((c) => ({ range: c.target.term.range, original: c.target.term.text, replacement: c.replacement }));
}
