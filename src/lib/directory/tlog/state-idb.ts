export interface TlogLogState {
	origin: string;
	treeSize: number;
	rootHashB64: string;
	updatedAt: number;
}

export interface TlogStateStore {
	get(origin: string): Promise<TlogLogState | null>;
	put(state: TlogLogState): Promise<void>;
}

const DB_NAME = 'thelemail-tlog';
const DB_VERSION = 1;
const LOG_STATE_STORE = 'log-state';

let dbPromise: Promise<IDBDatabase> | null = null;

function openTlogDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(LOG_STATE_STORE)) {
				db.createObjectStore(LOG_STATE_STORE, { keyPath: 'origin' });
			}
		};
		req.onsuccess = () => {
			req.result.onclose = () => {
				dbPromise = null;
			};
			resolve(req.result);
		};
		req.onerror = () => {
			dbPromise = null;
			reject(req.error);
		};
	});
	return dbPromise;
}

export const tlogStateStore: TlogStateStore = {
	async get(origin: string): Promise<TlogLogState | null> {
		const db = await openTlogDb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(LOG_STATE_STORE, 'readonly');
			const req = tx.objectStore(LOG_STATE_STORE).get(origin);
			req.onsuccess = () => resolve((req.result as TlogLogState) ?? null);
			req.onerror = () => reject(req.error);
		});
	},
	async put(state: TlogLogState): Promise<void> {
		const db = await openTlogDb();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(LOG_STATE_STORE, 'readwrite');
			const req = tx.objectStore(LOG_STATE_STORE).put(state);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});
	}
};
