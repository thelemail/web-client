const DB_NAME = 'thelemail-import';
const DB_VERSION = 1;
const IMPORT_FILES_STORE = 'files';

let dbPromise: Promise<IDBDatabase> | null = null;

function openImportDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(IMPORT_FILES_STORE)) {
				const store = db.createObjectStore(IMPORT_FILES_STORE, { keyPath: 'id' });
				store.createIndex('byAccount', 'accountId', { unique: false });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbPromise;
}

export type ImportFileStatus = 'pending' | 'done' | 'duplicate' | 'failed';

export interface ImportFileRecord {
	id: string;
	accountId: string;
	name: string;
	size: number;
	contentHash: string;
	bytes?: Uint8Array;
	status: ImportFileStatus;
	error?: string;
	messageId?: string;
	updatedAt: number;
}

function isTerminal(status: ImportFileStatus): boolean {
	return status === 'done' || status === 'duplicate' || status === 'failed';
}

export async function putImportFile(rec: ImportFileRecord): Promise<void> {
	const db = await openImportDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IMPORT_FILES_STORE, 'readwrite');
		tx.objectStore(IMPORT_FILES_STORE).put(rec);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function getImportFile(id: string): Promise<ImportFileRecord | null> {
	const db = await openImportDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IMPORT_FILES_STORE, 'readonly');
		const req = tx.objectStore(IMPORT_FILES_STORE).get(id);
		req.onsuccess = () => resolve((req.result as ImportFileRecord) ?? null);
		req.onerror = () => reject(req.error);
	});
}

export async function listImportFiles(accountId: string): Promise<ImportFileRecord[]> {
	const db = await openImportDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IMPORT_FILES_STORE, 'readonly');
		const req = tx.objectStore(IMPORT_FILES_STORE).index('byAccount').getAll(accountId);
		req.onsuccess = () => resolve((req.result as ImportFileRecord[]) ?? []);
		req.onerror = () => reject(req.error);
	});
}

export async function markTerminal(
	id: string,
	status: ImportFileStatus,
	extra: { error?: string; messageId?: string } = {}
): Promise<void> {
	const current = await getImportFile(id);
	if (!current) return;
	await putImportFile({
		...current,
		status,
		error: extra.error,
		messageId: extra.messageId,
		bytes: undefined,
		updatedAt: Date.now()
	});
}

export async function deleteImportFile(id: string): Promise<void> {
	const db = await openImportDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(IMPORT_FILES_STORE, 'readwrite');
		tx.objectStore(IMPORT_FILES_STORE).delete(id);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

export async function clearImportFiles(accountId: string): Promise<void> {
	const records = await listImportFiles(accountId);
	await Promise.all(records.map((r) => deleteImportFile(r.id)));
}

export async function clearTerminalImportFiles(accountId: string): Promise<void> {
	const records = await listImportFiles(accountId);
	await Promise.all(records.filter((r) => isTerminal(r.status)).map((r) => deleteImportFile(r.id)));
}
