import { openDatabase } from '$core/idb-open';

export interface SearchRecord {
	accountId: string;
	bundle: Uint8Array;
	generationId: string;
	installationSalt: Uint8Array;
	hasIndex: boolean;
}

export type Consent = 'saved' | 'declined';

export interface SearchPrefs {
	accountId: string;
	consent: Consent | null;
	paused: boolean;
	history: boolean;
}

export interface RecordStore {
	get(accountId: string): Promise<SearchRecord | null>;
	put(record: SearchRecord): Promise<void>;
	delete(accountId: string): Promise<void>;
}

export interface PrefStore {
	get(accountId: string): Promise<SearchPrefs>;
	put(prefs: SearchPrefs): Promise<void>;
	delete(accountId: string): Promise<void>;
}

export function defaultPrefs(accountId: string): SearchPrefs {
	return { accountId, consent: null, paused: false, history: false };
}

const DB_NAME = 'thelemail-search-keys';
const DB_VERSION = 2;
const ACCOUNTS = 'accounts';
const PREFS = 'prefs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	dbPromise ??= openDatabase(DB_NAME, DB_VERSION, (db) => {
		if (!db.objectStoreNames.contains(ACCOUNTS)) db.createObjectStore(ACCOUNTS, { keyPath: 'accountId' });
		if (!db.objectStoreNames.contains(PREFS)) db.createObjectStore(PREFS, { keyPath: 'accountId' });
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

function run<T>(store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(store, mode);
				const req = work(tx.objectStore(store));
				tx.oncomplete = () => resolve(req.result);
				tx.onerror = () => reject(tx.error);
				tx.onabort = () => reject(tx.error);
			})
	);
}

export const searchRecords: RecordStore = {
	async get(accountId) {
		return ((await run(ACCOUNTS, 'readonly', (s) => s.get(accountId))) as SearchRecord | undefined) ?? null;
	},
	async put(record) {
		await run(ACCOUNTS, 'readwrite', (s) => s.put(record));
	},
	async delete(accountId) {
		await run(ACCOUNTS, 'readwrite', (s) => s.delete(accountId));
	}
};

export const searchPrefs: PrefStore = {
	async get(accountId) {
		const stored = (await run(PREFS, 'readonly', (s) => s.get(accountId))) as SearchPrefs | undefined;
		return { ...defaultPrefs(accountId), ...stored };
	},
	async put(prefs) {
		await run(PREFS, 'readwrite', (s) => s.put(prefs));
	},
	async delete(accountId) {
		await run(PREFS, 'readwrite', (s) => s.delete(accountId));
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

export function memoryPrefs(): PrefStore {
	const prefs = new Map<string, SearchPrefs>();
	return {
		async get(accountId) {
			return { ...defaultPrefs(accountId), ...prefs.get(accountId) };
		},
		async put(p) {
			prefs.set(p.accountId, { ...p });
		},
		async delete(accountId) {
			prefs.delete(accountId);
		}
	};
}
