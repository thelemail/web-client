import type { Database, PreparedStatement } from '@thelemail/sqlite-wasm';
import { normalize } from './analysis';

export class Tokenizer {
	#db: Database;
	#ready = false;
	#clear: PreparedStatement | null = null;
	#insert: PreparedStatement | null = null;
	#read: PreparedStatement | null = null;

	constructor(db: Database) {
		this.#db = db;
	}

	#prepare(): void {
		if (this.#ready) return;
		this.#db.exec(`
			CREATE VIRTUAL TABLE IF NOT EXISTS temp.tl_tokens USING fts5 (t, tokenize = 'unicode61 remove_diacritics 2');
			CREATE VIRTUAL TABLE IF NOT EXISTS temp.tl_tokens_v USING fts5vocab (temp, tl_tokens, instance);
		`);
		this.#clear = this.#db.prepare('DELETE FROM temp.tl_tokens');
		this.#insert = this.#db.prepare('INSERT INTO temp.tl_tokens (rowid, t) VALUES (1, ?)');
		this.#read = this.#db.prepare('SELECT term, offset FROM temp.tl_tokens_v ORDER BY offset');
		this.#ready = true;
	}

	tokens(text: string): string[] {
		this.#prepare();
		this.#clear!.stepReset();
		this.#insert!.bind([normalize(text)]).stepReset();
		const out: string[] = [];
		const read = this.#read!;
		try {
			while (read.step()) out[read.getInt(1)!] = read.getString(0)!;
		} finally {
			read.reset();
		}
		return out;
	}

	dispose(): void {
		for (const s of [this.#clear, this.#insert, this.#read]) s?.finalize();
		this.#clear = this.#insert = this.#read = null;
		if (this.#ready && this.#db.isOpen()) this.#db.exec('DROP TABLE IF EXISTS temp.tl_tokens_v; DROP TABLE IF EXISTS temp.tl_tokens;');
		this.#ready = false;
	}
}

export function nearWithin(tokens: readonly string[], left: readonly string[], right: readonly string[], distance: number): boolean {
	const starts = (phrase: readonly string[]) => {
		const out: number[] = [];
		for (let i = 0; i + phrase.length <= tokens.length; i++) {
			if (phrase.every((t, j) => tokens[i + j] === t)) out.push(i);
		}
		return out;
	};
	const a = starts(left);
	const b = starts(right);
	for (const x of a) {
		for (const y of b) {
			const [end, second] = x <= y ? [x + left.length, y] : [y + right.length, x];
			if (end > second) continue;
			if (second - end <= distance) return true;
		}
	}
	return false;
}
