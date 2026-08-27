import { openDb, DIRECTORY_SEEN_STORE } from '$lib/idb';

export interface SeenRecord {
	address: string;
	version: number;
	keyFingerprint: string;
	firstSeenAt: number;
	lastSeenAt: number;
}

export async function getSeen(address: string): Promise<SeenRecord | null> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(DIRECTORY_SEEN_STORE, 'readonly');
		const req = tx.objectStore(DIRECTORY_SEEN_STORE).get(address);
		req.onsuccess = () => resolve((req.result as SeenRecord) ?? null);
		req.onerror = () => reject(req.error);
	});
}

export async function upsertSeen(record: SeenRecord): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(DIRECTORY_SEEN_STORE, 'readwrite');
		const req = tx.objectStore(DIRECTORY_SEEN_STORE).put(record);
		req.onsuccess = () => resolve();
		req.onerror = () => reject(req.error);
	});
}
