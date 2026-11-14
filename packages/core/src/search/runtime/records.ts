import { openDatabase } from '$core/idb-open';

export interface SearchRecord {
	accountId: string;
	bundle: Uint8Array;
	generationId: string;
	installationSalt: Uint8Array;
	hasIndex: boolean;
}

export interface RecordStore {
	get(accountId: string): Promise<SearchRecord | null>;
	put(record: SearchRecord): Promise<void>;
	delete(accountId: string): Promise<void>;
}

const DB_NAME = 'thelemail-search-keys';
const DB_VERSION = 1;
const STORE = 'accounts';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	dbPromise ??= openDatabase(DB_NAME, DB_VERSION, (db) => {
		if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'accountId' });
	})
		.then((db) => {
			db.onclose = () => {
				dbPromise = null;
			};
			db.onversionchange = () => {
				db.close();
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

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(STORE, mode);
				const req = work(tx.objectStore(STORE));
				tx.oncomplete = () => resolve(req.result);
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			})
	);
}

export const searchRecords: RecordStore = {
	async get(accountId) {
		return ((await run('readonly', (s) => s.get(accountId))) as SearchRecord | undefined) ?? null;
	},
	async put(record) {
		await run('readwrite', (s) => s.put(record));
	},
	async delete(accountId) {
		await run('readwrite', (s) => s.delete(accountId));
	}
};

export function memoryRecords(): RecordStore {
	const records = new Map<string, SearchRecord>();
	return {
		async get(accountId) {
			return records.get(accountId) ?? null;
		},
		async put(record) {
			records.set(record.accountId, record);
		},
		async delete(accountId) {
			records.delete(accountId);
		}
	};
}
