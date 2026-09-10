import { openDatabase } from '$core/idb-open';
import { emptyMeta, type IndexChunk, type IndexMeta, type IndexedRow } from './types';

export interface SearchDb {
	rows(accountId: string): Promise<IndexedRow[]>;
	putRows(rows: IndexedRow[]): Promise<void>;
	deleteRows(accountId: string, ids: string[]): Promise<void>;
	chunks(accountId: string): Promise<IndexChunk[]>;
	putChunk(chunk: IndexChunk): Promise<void>;
	meta(accountId: string): Promise<IndexMeta>;
	putMeta(meta: IndexMeta): Promise<void>;
	clear(accountId: string): Promise<void>;
}

const DB_NAME = 'thelemail-search';
const DB_VERSION = 1;
const ROWS = 'rows';
const CHUNKS = 'chunks';
const META = 'meta';
const BY_ACCOUNT = 'byAccount';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = openDatabase(DB_NAME, DB_VERSION, (db) => {
		if (!db.objectStoreNames.contains(ROWS)) {
			db.createObjectStore(ROWS, { keyPath: ['accountId', 'id'] }).createIndex(
				BY_ACCOUNT,
				'accountId'
			);
		}
		if (!db.objectStoreNames.contains(CHUNKS)) {
			db.createObjectStore(CHUNKS, { keyPath: ['accountId', 'chunkId'] }).createIndex(
				BY_ACCOUNT,
				'accountId'
			);
		}
		if (!db.objectStoreNames.contains(META)) {
			db.createObjectStore(META, { keyPath: 'accountId' });
		}
	})
		.then((db) => {
			db.onclose = () => {
				dbPromise = null;
			};
			return db;
		})
		.catch((err) => {
			dbPromise = null;
			throw err;
		});
	return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

async function clearAccount(store: string, accountId: string): Promise<void> {
	const db = await openDb();
	const tx = db.transaction(store, 'readwrite');
	const keys = await request(tx.objectStore(store).index(BY_ACCOUNT).getAllKeys(accountId));
	for (const key of keys) tx.objectStore(store).delete(key);
	await done(tx);
}

export const idbSearchDb: SearchDb = {
	async rows(accountId) {
		const db = await openDb();
		const tx = db.transaction(ROWS, 'readonly');
		return request(tx.objectStore(ROWS).index(BY_ACCOUNT).getAll(accountId)) as Promise<
			IndexedRow[]
		>;
	},
	async putRows(rows) {
		if (!rows.length) return;
		const db = await openDb();
		const tx = db.transaction(ROWS, 'readwrite');
		for (const row of rows) tx.objectStore(ROWS).put(row);
		await done(tx);
	},
	async deleteRows(accountId, ids) {
		if (!ids.length) return;
		const db = await openDb();
		const tx = db.transaction(ROWS, 'readwrite');
		for (const id of ids) tx.objectStore(ROWS).delete([accountId, id]);
		await done(tx);
	},
	async chunks(accountId) {
		const db = await openDb();
		const tx = db.transaction(CHUNKS, 'readonly');
		return request(tx.objectStore(CHUNKS).index(BY_ACCOUNT).getAll(accountId)) as Promise<
			IndexChunk[]
		>;
	},
	async putChunk(chunk) {
		const db = await openDb();
		const tx = db.transaction(CHUNKS, 'readwrite');
		tx.objectStore(CHUNKS).put(chunk);
		await done(tx);
	},
	async meta(accountId) {
		const db = await openDb();
		const tx = db.transaction(META, 'readonly');
		const found = (await request(tx.objectStore(META).get(accountId))) as IndexMeta | undefined;
		return found ?? emptyMeta(accountId);
	},
	async putMeta(meta) {
		const db = await openDb();
		const tx = db.transaction(META, 'readwrite');
		tx.objectStore(META).put(meta);
		await done(tx);
	},
	async clear(accountId) {
		await clearAccount(ROWS, accountId);
		await clearAccount(CHUNKS, accountId);
		const db = await openDb();
		const tx = db.transaction(META, 'readwrite');
		tx.objectStore(META).delete(accountId);
		await done(tx);
	}
};

export function memorySearchDb(): SearchDb {
	const rows = new Map<string, IndexedRow>();
	const chunks = new Map<string, IndexChunk>();
	const metas = new Map<string, IndexMeta>();
	const key = (a: string, b: string | number) => `${a} ${b}`;
	return {
		async rows(accountId) {
			return [...rows.values()].filter((r) => r.accountId === accountId);
		},
		async putRows(next) {
			for (const row of next) rows.set(key(row.accountId, row.id), row);
		},
		async deleteRows(accountId, ids) {
			for (const id of ids) rows.delete(key(accountId, id));
		},
		async chunks(accountId) {
			return [...chunks.values()].filter((c) => c.accountId === accountId);
		},
		async putChunk(chunk) {
			chunks.set(key(chunk.accountId, chunk.chunkId), chunk);
		},
		async meta(accountId) {
			return metas.get(accountId) ?? emptyMeta(accountId);
		},
		async putMeta(meta) {
			metas.set(meta.accountId, meta);
		},
		async clear(accountId) {
			for (const [k, v] of [...rows]) if (v.accountId === accountId) rows.delete(k);
			for (const [k, v] of [...chunks]) if (v.accountId === accountId) chunks.delete(k);
			metas.delete(accountId);
		}
	};
}
