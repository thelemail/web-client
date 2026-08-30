import { browser } from '$app/environment';
import { SvelteMap } from 'svelte/reactivity';

const DB_NAME = 'thelemail-avatars';
const DB_VERSION = 1;
const STORE = 'avatars';
const MAX_BYTES = 512 * 1024;

interface AvatarRecord {
	accountId: string;
	blob: Blob;
	sourceUrl: string;
	updatedAt: number;
}

const objectUrls = new SvelteMap<string, string>();

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				db.createObjectStore(STORE, { keyPath: 'accountId' });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbPromise;
}

function txn(mode: IDBTransactionMode): Promise<IDBObjectStore> {
	return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function adopt(rec: AvatarRecord): void {
	const previous = objectUrls.get(rec.accountId);
	if (previous) URL.revokeObjectURL(previous);
	objectUrls.set(rec.accountId, URL.createObjectURL(rec.blob));
}

export function cachedAvatarUrl(accountId: string): string | null {
	return objectUrls.get(accountId) ?? null;
}

export async function hydrateAvatarCache(): Promise<void> {
	if (!browser) return;
	try {
		const store = await txn('readonly');
		const all = (await reqAsPromise(store.getAll())) as AvatarRecord[];
		for (const rec of all ?? []) adopt(rec);
	} catch {
		return;
	}
}

export async function cacheAccountAvatar(accountId: string, url: string | null): Promise<void> {
	if (!browser) return;
	if (!url) {
		await forgetAccountAvatar(accountId);
		return;
	}
	try {
		const res = await fetch(url);
		if (!res.ok) return;
		const blob = await res.blob();
		if (blob.size === 0 || blob.size > MAX_BYTES) return;
		if (!blob.type.startsWith('image/')) return;
		const rec: AvatarRecord = { accountId, blob, sourceUrl: url, updatedAt: Date.now() };
		const store = await txn('readwrite');
		await reqAsPromise(store.put(rec));
		adopt(rec);
	} catch {
		return;
	}
}

export async function forgetAccountAvatar(accountId: string): Promise<void> {
	if (!browser) return;
	const previous = objectUrls.get(accountId);
	if (previous) URL.revokeObjectURL(previous);
	objectUrls.delete(accountId);
	try {
		const store = await txn('readwrite');
		await reqAsPromise(store.delete(accountId));
	} catch {
		return;
	}
}

export async function forgetAllAvatars(): Promise<void> {
	if (!browser) return;
	for (const url of objectUrls.values()) URL.revokeObjectURL(url);
	objectUrls.clear();
	try {
		const store = await txn('readwrite');
		await reqAsPromise(store.clear());
	} catch {
		return;
	}
}
