import type { VaultRecord } from '../idb';

const DB_NAME = 'thelemail-handoff';
const DB_VERSION = 1;
const REQUESTS = 'requests';
const STAGED = 'staged';

export interface HandoffRecord {
	requestId: string;
	privateKey: CryptoKey;
	receiverPublicKey: Uint8Array;
	verifier: string;
	state: string;
	descriptorDigest: string;
	clientId: string;
	callback: string;
	expectedAccountId: string | null;
	route: string;
	remember: boolean;
	createdAt: number;
	expiresAt: number;
	adoptBy?: number;
	accountId?: string;
	sessionId?: string;
}

export interface StagedVault {
	requestId: string;
	record: VaultRecord;
}

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (opening) return opening;
	opening = new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(REQUESTS)) db.createObjectStore(REQUESTS, { keyPath: 'requestId' });
			if (!db.objectStoreNames.contains(STAGED)) db.createObjectStore(STAGED, { keyPath: 'requestId' });
		};
		req.onsuccess = () => {
			const db = req.result;
			db.onversionchange = () => {
				db.close();
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
			reject(new Error('handoff store upgrade blocked'));
		};
	});
	return opening;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const tx = db.transaction(store, mode);
				const req = fn(tx.objectStore(store));
				let result: T;
				req.onsuccess = () => {
					result = req.result;
				};
				tx.oncomplete = () => resolve(result);
				tx.onerror = () => reject(tx.error ?? req.error);
				tx.onabort = () => reject(tx.error ?? new Error('handoff store transaction aborted'));
			})
	);
}

export function putRequest(r: HandoffRecord): Promise<IDBValidKey> {
	return run(REQUESTS, 'readwrite', (s) => s.put(r));
}

export async function getRequest(requestId: string): Promise<HandoffRecord | null> {
	return (await run<HandoffRecord | undefined>(REQUESTS, 'readonly', (s) => s.get(requestId))) ?? null;
}

export function deleteRequest(requestId: string): Promise<undefined> {
	return run(REQUESTS, 'readwrite', (s) => s.delete(requestId));
}

export async function purgeExpiredRequests(now = Date.now()): Promise<string[]> {
	const all = await run<HandoffRecord[]>(REQUESTS, 'readonly', (s) => s.getAll());
	const gone = all.filter((r) => Math.max(r.expiresAt, r.adoptBy ?? 0) * 1000 <= now).map((r) => r.requestId);
	for (const id of gone) {
		await deleteRequest(id);
		await deleteStaged(id);
	}
	return gone;
}

export function putStaged(v: StagedVault): Promise<IDBValidKey> {
	return run(STAGED, 'readwrite', (s) => s.put(v));
}

export async function getStaged(requestId: string): Promise<StagedVault | null> {
	return (await run<StagedVault | undefined>(STAGED, 'readonly', (s) => s.get(requestId))) ?? null;
}

export function deleteStaged(requestId: string): Promise<undefined> {
	return run(STAGED, 'readwrite', (s) => s.delete(requestId));
}
