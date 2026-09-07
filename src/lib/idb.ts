import { openDatabase } from './idb-open';

const DB_NAME = 'thelemail';
const DB_VERSION = 4;

export const VAULT_STORE = 'vault';
export const DIRECTORY_SEEN_STORE = 'directory_seen';
export const ACCOUNTS_STORE = 'accounts';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = openDatabase(DB_NAME, DB_VERSION, (db) => {
		if (!db.objectStoreNames.contains(VAULT_STORE)) {
			db.createObjectStore(VAULT_STORE, { keyPath: 'accountId' });
		}
		if (!db.objectStoreNames.contains(DIRECTORY_SEEN_STORE)) {
			db.createObjectStore(DIRECTORY_SEEN_STORE, { keyPath: 'address' });
		}
		if (!db.objectStoreNames.contains(ACCOUNTS_STORE)) {
			const accounts = db.createObjectStore(ACCOUNTS_STORE, { keyPath: 'accountId' });
			accounts.createIndex('bySlot', 'slot', { unique: true });
		}
	}).catch((err) => {
		dbPromise = null;
		throw err;
	});
	return dbPromise;
}
