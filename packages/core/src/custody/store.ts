import type { VaultRecord } from '$core/keystore/idb';
import type { CustodyJournal } from './journal';
import { JOURNAL_SCHEMA } from './journal';

const DB_NAME = 'thelemail-custody';
const DB_VERSION = 1;
const JOURNAL = 'journal';
const VAULTS = 'vaults';
const STAGED = 'staged';

export interface StagedCustodyVault {
	migrationId: string;
	accountId: string;
	record: VaultRecord;
}

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (opening) return opening;
	opening = new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(JOURNAL)) db.createObjectStore(JOURNAL, { keyPath: 'accountId' });
			if (!db.objectStoreNames.contains(VAULTS)) db.createObjectStore(VAULTS, { keyPath: 'accountId' });
			if (!db.objectStoreNames.contains(STAGED)) db.createObjectStore(STAGED, { keyPath: 'migrationId' });
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => {
				db.close();
				opening = null;
			};
			db.onclose = () => {
				opening = null;
			};
			resolve(db);
		};
		req.onerror = () => {
			opening = null;
			reject(req.error);
		};
		req.onblocked = () => {
			opening = null;
			reject(new Error('custody store upgrade blocked'));
		};
	});
	return opening;
}

function transact<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => (() => T) | void): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(stores, mode);
				let result: (() => T) | void;
				tx.oncomplete = () => resolve(result ? result() : (undefined as T));
				tx.onerror = () => reject(tx.error ?? new Error('custody store transaction failed'));
				tx.onabort = () => reject(tx.error ?? new Error('custody store transaction aborted'));
				try {
					result = fn(tx);
				} catch (err) {
					try {
						tx.abort();
					} catch {
						reject(err);
					}
				}
			})
	);
}

function read<T>(store: string, key: string): Promise<T | null> {
	return transact<T | null>([store], 'readonly', (tx) => {
		const req = tx.objectStore(store).get(key);
		return () => (req.result as T | undefined) ?? null;
	});
}

function readAll<T>(store: string): Promise<T[]> {
	return transact<T[]>([store], 'readonly', (tx) => {
		const req = tx.objectStore(store).getAll();
		return () => (req.result ?? []) as T[];
	});
}

export function getJournal(accountId: string): Promise<CustodyJournal | null> {
	return read<CustodyJournal>(JOURNAL, accountId);
}

export function getAllJournals(): Promise<CustodyJournal[]> {
	return readAll<CustodyJournal>(JOURNAL);
}

export function putJournal(journal: CustodyJournal): Promise<void> {
	return transact<void>([JOURNAL], 'readwrite', (tx) => {
		tx.objectStore(JOURNAL).put({ ...journal, schema: JOURNAL_SCHEMA });
	});
}

export function getCustodyVault(accountId: string): Promise<VaultRecord | null> {
	return read<VaultRecord>(VAULTS, accountId);
}

export function getAllCustodyVaults(): Promise<VaultRecord[]> {
	return readAll<VaultRecord>(VAULTS);
}

export function putStagedVault(staged: StagedCustodyVault): Promise<void> {
	return transact<void>([STAGED], 'readwrite', (tx) => {
		tx.objectStore(STAGED).put(staged);
	});
}

export function getStagedVault(migrationId: string): Promise<StagedCustodyVault | null> {
	return read<StagedCustodyVault>(STAGED, migrationId);
}

export function deleteStagedVault(migrationId: string): Promise<void> {
	return transact<void>([STAGED], 'readwrite', (tx) => {
		tx.objectStore(STAGED).delete(migrationId);
	});
}

export function commitCustody(journal: CustodyJournal, record: VaultRecord): Promise<void> {
	return transact<void>([JOURNAL, VAULTS, STAGED], 'readwrite', (tx) => {
		tx.objectStore(VAULTS).put(record);
		tx.objectStore(STAGED).delete(journal.migrationId);
		tx.objectStore(JOURNAL).put({ ...journal, schema: JOURNAL_SCHEMA });
	});
}

export function putCustodyVault(record: VaultRecord, journal: CustodyJournal): Promise<void> {
	return transact<void>([JOURNAL, VAULTS], 'readwrite', (tx) => {
		tx.objectStore(VAULTS).put(record);
		tx.objectStore(JOURNAL).put({ ...journal, schema: JOURNAL_SCHEMA });
	});
}

export function forgetCustody(accountId: string): Promise<void> {
	return transact<void>([JOURNAL, VAULTS, STAGED], 'readwrite', (tx) => {
		tx.objectStore(JOURNAL).delete(accountId);
		tx.objectStore(VAULTS).delete(accountId);
		const staged = tx.objectStore(STAGED);
		const cursor = staged.openCursor();
		cursor.onsuccess = () => {
			const c = cursor.result;
			if (!c) return;
			if ((c.value as StagedCustodyVault).accountId === accountId) c.delete();
			c.continue();
		};
	});
}

export function forgetAllCustody(): Promise<void> {
	return transact<void>([JOURNAL, VAULTS, STAGED], 'readwrite', (tx) => {
		tx.objectStore(JOURNAL).clear();
		tx.objectStore(VAULTS).clear();
		tx.objectStore(STAGED).clear();
	});
}
