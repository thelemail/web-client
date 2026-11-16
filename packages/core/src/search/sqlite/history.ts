import type { Database } from '@thelemail/sqlite-wasm';

export const HISTORY_LIMIT = 30;
export const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const IV_BYTES = 12;
const AAD = new TextEncoder().encode('thelemail-search-history/v1');

export async function historyKey(raw: Uint8Array): Promise<CryptoKey> {
	try {
		return await crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
	} finally {
		raw.fill(0);
	}
}

export class SearchHistory {
	#db: Database;
	#key: CryptoKey;

	constructor(db: Database, key: CryptoKey) {
		this.#db = db;
		this.#key = key;
	}

	async #seal(query: string): Promise<Uint8Array> {
		const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
		const sealed = new Uint8Array(
			await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, this.#key, new TextEncoder().encode(query) as BufferSource)
		);
		const out = new Uint8Array(IV_BYTES + sealed.length);
		out.set(iv);
		out.set(sealed, IV_BYTES);
		return out;
	}

	async #open(sealed: Uint8Array): Promise<string | null> {
		if (sealed.length <= IV_BYTES) return null;
		try {
			const plain = await crypto.subtle.decrypt(
				{ name: 'AES-GCM', iv: sealed.subarray(0, IV_BYTES) as BufferSource, additionalData: AAD },
				this.#key,
				sealed.subarray(IV_BYTES) as BufferSource
			);
			return new TextDecoder('utf-8', { fatal: true }).decode(plain);
		} catch {
			return null;
		}
	}

	#prune(now: number): void {
		this.#db.exec({ sql: 'DELETE FROM history WHERE at < ?', bind: [now - HISTORY_MAX_AGE_MS] });
		this.#db.exec({ sql: 'DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY at DESC, id DESC LIMIT ?)', bind: [HISTORY_LIMIT] });
	}

	async #entries(): Promise<{ id: number; query: string | null }[]> {
		const rows = this.#db.selectArrays('SELECT id, sealed FROM history ORDER BY at DESC, id DESC') as [number, Uint8Array][];
		return Promise.all(rows.map(async ([id, sealed]) => ({ id, query: await this.#open(sealed) })));
	}

	async list(now: number): Promise<string[]> {
		this.#prune(now);
		const entries = await this.#entries();
		const broken = entries.filter((e) => e.query === null).map((e) => e.id);
		for (const id of broken) this.#db.exec({ sql: 'DELETE FROM history WHERE id = ?', bind: [id] });
		return entries.flatMap((e) => (e.query === null ? [] : [e.query]));
	}

	async add(query: string, now: number): Promise<void> {
		const text = query.trim();
		if (!text) return;
		const sealed = await this.#seal(text);
		const repeats = (await this.#entries()).filter((e) => e.query === text || e.query === null).map((e) => e.id);
		this.#db.transaction('IMMEDIATE', () => {
			for (const id of repeats) this.#db.exec({ sql: 'DELETE FROM history WHERE id = ?', bind: [id] });
			this.#db.exec({ sql: 'INSERT INTO history (at, sealed) VALUES (?, ?)', bind: [now, sealed] });
			this.#prune(now);
		});
	}

	clear(): void {
		this.#db.exec('DELETE FROM history');
		this.#db.exec('VACUUM');
	}
}
