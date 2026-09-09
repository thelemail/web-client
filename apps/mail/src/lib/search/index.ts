import { listMessageChanges, listMessages, type ListMessagesOptions } from '$core/api/messages';
import type { MessageListItem } from '$core/api/types';
import { decryptPreview } from '$lib/mail/decrypt';
import { idbSearchDb, type SearchDb } from './db';
import {
	excerptFor,
	hasFilters,
	isEmptyQuery,
	matchesFrom,
	matchesRow,
	parseQuery,
	scoreText
} from './query';
import { rowFor, textFor, undecryptableText } from './records';
import { openChunk, sealChunk } from './seal';
import {
	backfillComplete,
	emptyMeta,
	SCOPES,
	type IndexMeta,
	type IndexedRow,
	type IndexedText,
	type ScopeId
} from './types';

const PAGE_SIZE = 200;
const CHANGES_LIMIT = 500;

export interface IndexProgress {
	indexed: number;
	complete: boolean;
}

export interface SearchResult {
	row: IndexedRow;
	text: IndexedText;
	excerpt: string;
	score: number;
}

function optionsFor(scope: ScopeId): ListMessagesOptions {
	const base: ListMessagesOptions = { limit: PAGE_SIZE, sort: 'oldest' };
	switch (scope) {
		case 'inbox':
			return { ...base, mailbox: 'inbox', direction: 'received' };
		case 'sent':
			return { ...base, mailbox: 'inbox', direction: 'sent' };
		case 'archive':
			return { ...base, mailbox: 'archive' };
		case 'spam':
			return { ...base, mailbox: 'spam' };
		case 'trash':
			return { ...base, mailbox: 'trash' };
		case 'snoozed':
			return { ...base, mailbox: 'snoozed' };
	}
}

export class SearchIndex {
	#db: SearchDb;
	#accountId: string | null = null;
	#rows = new Map<string, IndexedRow>();
	#texts = new Map<string, IndexedText>();
	#meta: IndexMeta | null = null;
	#loading: Promise<void> | null = null;
	#running: Promise<void> | null = null;
	#listeners = new Set<(p: IndexProgress) => void>();

	constructor(db: SearchDb = idbSearchDb) {
		this.#db = db;
	}

	get accountId(): string | null {
		return this.#accountId;
	}

	get progress(): IndexProgress {
		return {
			indexed: this.#rows.size,
			complete: this.#meta ? backfillComplete(this.#meta) : false
		};
	}

	subscribe(cb: (p: IndexProgress) => void): () => void {
		this.#listeners.add(cb);
		return () => this.#listeners.delete(cb);
	}

	#emit(): void {
		const snapshot = this.progress;
		for (const cb of this.#listeners) cb(snapshot);
	}

	async open(accountId: string): Promise<void> {
		if (this.#accountId === accountId && this.#meta) return this.#loading ?? Promise.resolve();
		this.#accountId = accountId;
		this.#rows = new Map();
		this.#texts = new Map();
		this.#meta = null;
		this.#loading = this.#load(accountId);
		return this.#loading;
	}

	async #load(accountId: string): Promise<void> {
		const [rows, chunks, meta] = await Promise.all([
			this.#db.rows(accountId),
			this.#db.chunks(accountId),
			this.#db.meta(accountId)
		]);
		if (this.#accountId !== accountId) return;
		for (const row of rows) this.#rows.set(row.id, row);
		for (const chunk of chunks) {
			let texts: IndexedText[];
			try {
				texts = await openChunk(accountId, chunk);
			} catch {
				continue;
			}
			if (this.#accountId !== accountId) return;
			for (const text of texts) {
				if (this.#rows.has(text.id)) this.#texts.set(text.id, text);
			}
		}
		this.#meta = meta;
		this.#emit();
	}

	close(): void {
		this.#accountId = null;
		this.#rows = new Map();
		this.#texts = new Map();
		this.#meta = null;
		this.#loading = null;
		this.#emit();
	}

	async clear(accountId: string): Promise<void> {
		await this.#db.clear(accountId);
		if (this.#accountId === accountId) {
			this.#rows = new Map();
			this.#texts = new Map();
			this.#meta = emptyMeta(accountId);
			this.#emit();
		}
	}

	sync(accountId: string): Promise<void> {
		if (this.#running) return this.#running;
		const run = this.#sync(accountId).finally(() => {
			this.#running = null;
		});
		this.#running = run;
		return run;
	}

	async #sync(accountId: string): Promise<void> {
		await this.open(accountId);
		if (this.#accountId !== accountId || !this.#meta) return;
		await this.#backfill(accountId);
		if (this.#accountId !== accountId) return;
		await this.#drain(accountId);
	}

	async #backfill(accountId: string): Promise<void> {
		for (const scope of SCOPES) {
			while (this.#accountId === accountId && this.#meta) {
				const progress = this.#meta.scopes[scope];
				if (progress?.done) break;
				const opts = optionsFor(scope);
				const cursor = progress?.cursor ?? undefined;
				const resp = await listMessages({ ...opts, cursor });
				if (this.#accountId !== accountId || !this.#meta) return;
				await this.#absorb(accountId, resp.items);
				if (this.#accountId !== accountId || !this.#meta) return;
				const next = resp.nextCursor ?? null;
				this.#meta = {
					...this.#meta,
					scopes: {
						...this.#meta.scopes,
						[scope]: { cursor: next, done: next === null }
					},
					indexedCount: this.#rows.size,
					updatedAt: Date.now()
				};
				await this.#db.putMeta(this.#meta);
				this.#emit();
				if (next === null) break;
			}
		}
	}

	async #drain(accountId: string): Promise<void> {
		let guard = 0;
		while (this.#accountId === accountId && this.#meta && guard < 50) {
			guard += 1;
			const cursor = this.#meta.changesCursor ?? undefined;
			const resp = await listMessageChanges({ cursor, limit: CHANGES_LIMIT });
			if (this.#accountId !== accountId || !this.#meta) return;
			if (resp.resyncRequired) {
				await this.clear(accountId);
				if (this.#accountId !== accountId) return;
				await this.#backfill(accountId);
				return;
			}
			const removed = resp.changes.filter((c) => c.deleted).map((c) => c.id);
			const changed = resp.changes
				.filter((c) => !c.deleted && c.message)
				.map((c) => c.message as MessageListItem);
			if (removed.length) {
				await this.#db.deleteRows(accountId, removed);
				for (const id of removed) {
					this.#rows.delete(id);
					this.#texts.delete(id);
				}
			}
			await this.#absorb(accountId, changed);
			if (this.#accountId !== accountId || !this.#meta) return;
			this.#meta = {
				...this.#meta,
				changesCursor: resp.nextCursor,
				indexedCount: this.#rows.size,
				updatedAt: Date.now()
			};
			await this.#db.putMeta(this.#meta);
			this.#emit();
			if (!resp.hasMore) return;
		}
	}

	async #absorb(accountId: string, items: MessageListItem[]): Promise<void> {
		if (!items.length || !this.#meta) return;
		const fresh = items.filter((item) => !this.#texts.has(item.id));
		const reuse = items.filter((item) => this.#texts.has(item.id));

		if (reuse.length) {
			const updated = reuse.map((item) =>
				rowFor(accountId, item, this.#rows.get(item.id)?.chunkId ?? -1)
			);
			await this.#db.putRows(updated);
			for (const row of updated) this.#rows.set(row.id, row);
		}

		if (!fresh.length) return;

		const chunkId = this.#meta.nextChunkId;
		const texts: IndexedText[] = [];
		const rows: IndexedRow[] = [];
		for (const item of fresh) {
			let text: IndexedText;
			try {
				text = textFor(item, await decryptPreview(accountId, item.encryptedPreview));
			} catch {
				text = undecryptableText(item);
			}
			if (this.#accountId !== accountId) return;
			texts.push(text);
			rows.push(rowFor(accountId, item, chunkId));
		}

		const chunk = await sealChunk(accountId, chunkId, texts);
		if (this.#accountId !== accountId || !this.#meta) return;
		await this.#db.putChunk(chunk);
		await this.#db.putRows(rows);
		for (const row of rows) this.#rows.set(row.id, row);
		for (const text of texts) this.#texts.set(text.id, text);
		this.#meta = { ...this.#meta, nextChunkId: chunkId + 1 };
	}

	search(text: string, limit = 200): SearchResult[] {
		const parsed = parseQuery(text);
		if (isEmptyQuery(parsed)) return [];
		const { terms } = parsed;
		const filtersOnly = terms.length === 0 && hasFilters(parsed);
		const hits: SearchResult[] = [];
		for (const [id, row] of this.#rows) {
			if (!matchesRow(row, parsed)) continue;
			const indexed = this.#texts.get(id);
			if (!indexed) continue;
			if (!matchesFrom(indexed, parsed)) continue;
			const score = filtersOnly ? 0 : scoreText(indexed, terms);
			if (!filtersOnly && score <= 0) continue;
			hits.push({ row, text: indexed, excerpt: excerptFor(indexed, terms), score });
		}
		hits.sort((a, b) => b.score - a.score || b.row.storedAt - a.row.storedAt);
		return hits.slice(0, limit);
	}
}

export const searchIndex = new SearchIndex();
