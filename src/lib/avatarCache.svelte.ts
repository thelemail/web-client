import { browser } from '$app/environment';
import { SvelteMap } from 'svelte/reactivity';
import { platform } from '$platform';

const DB_NAME = 'thelemail-avatars';
const DB_VERSION = 2;
const ACCOUNT_STORE = 'avatars';
const PEOPLE_STORE = 'people';
const MAX_BYTES = 512 * 1024;

interface AvatarRecord {
	accountId: string;
	blob: Blob;
	sourceUrl: string;
	updatedAt: number;
}

interface PersonRecord {
	key: string;
	accountId: string;
	address: string;
	blob: Blob;
	sourceUrl: string;
	updatedAt: number;
}

export interface CachedPersonAvatar {
	url: string;
	updatedAt: number;
}

const accountUrls = new SvelteMap<string, string>();
const accountSources = new Map<string, string>();
const personUrls = new SvelteMap<string, string>();
const personSources = new Map<string, string>();

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(ACCOUNT_STORE)) {
				db.createObjectStore(ACCOUNT_STORE, { keyPath: 'accountId' });
			}
			if (!db.objectStoreNames.contains(PEOPLE_STORE)) {
				const people = db.createObjectStore(PEOPLE_STORE, { keyPath: 'key' });
				people.createIndex('byAccount', 'accountId', { unique: false });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbPromise;
}

function txn(store: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
	return openDb().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export function imageMimeFromBytes(bytes: Uint8Array): string | null {
	if (bytes.length < 12) return null;
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return 'image/png';
	}
	if (
		bytes[0] === 0x47 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x38 &&
		(bytes[4] === 0x37 || bytes[4] === 0x39) &&
		bytes[5] === 0x61
	) {
		return 'image/gif';
	}
	if (
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	return null;
}

export function sourcePath(url: string): string {
	try {
		const u = new URL(url);
		return `${u.origin}${u.pathname}`;
	} catch {
		return url;
	}
}

async function fetchImage(url: string): Promise<Blob | null> {
	const res = await platform.blobFetch(url);
	if (!res.ok) return null;
	const buf = await res.arrayBuffer();
	if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
	const type = imageMimeFromBytes(new Uint8Array(buf));
	if (!type) return null;
	return new Blob([buf], { type });
}

function personKey(accountId: string, address: string): string {
	return `${accountId}\n${address}`;
}

function adoptAccount(rec: AvatarRecord): void {
	const previous = accountUrls.get(rec.accountId);
	if (previous) URL.revokeObjectURL(previous);
	accountUrls.set(rec.accountId, URL.createObjectURL(rec.blob));
	accountSources.set(rec.accountId, sourcePath(rec.sourceUrl));
}

function adoptPerson(rec: PersonRecord): string {
	const previous = personUrls.get(rec.key);
	if (previous) URL.revokeObjectURL(previous);
	const url = URL.createObjectURL(rec.blob);
	personUrls.set(rec.key, url);
	personSources.set(rec.key, sourcePath(rec.sourceUrl));
	return url;
}

export function cachedAvatarUrl(accountId: string): string | null {
	return accountUrls.get(accountId) ?? null;
}

export async function hydrateAvatarCache(): Promise<void> {
	if (!browser) return;
	try {
		const store = await txn(ACCOUNT_STORE, 'readonly');
		const all = (await reqAsPromise(store.getAll())) as AvatarRecord[];
		for (const rec of all ?? []) adoptAccount(rec);
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
	if (accountUrls.has(accountId) && accountSources.get(accountId) === sourcePath(url)) return;
	try {
		const blob = await fetchImage(url);
		if (!blob) return;
		const rec: AvatarRecord = { accountId, blob, sourceUrl: url, updatedAt: Date.now() };
		const store = await txn(ACCOUNT_STORE, 'readwrite');
		await reqAsPromise(store.put(rec));
		adoptAccount(rec);
	} catch {
		return;
	}
}

export async function hydratePersonAvatars(
	accountId: string
): Promise<Map<string, CachedPersonAvatar>> {
	const out = new Map<string, CachedPersonAvatar>();
	if (!browser) return out;
	try {
		const store = await txn(PEOPLE_STORE, 'readonly');
		const rows = (await reqAsPromise(
			store.index('byAccount').getAll(accountId)
		)) as PersonRecord[];
		for (const rec of rows ?? []) {
			out.set(rec.address, { url: adoptPerson(rec), updatedAt: rec.updatedAt });
		}
	} catch {
		return out;
	}
	return out;
}

export async function cachePersonAvatar(
	accountId: string,
	address: string,
	url: string
): Promise<string | null> {
	if (!browser) return null;
	const key = personKey(accountId, address);
	const existing = personUrls.get(key);
	if (existing && personSources.get(key) === sourcePath(url)) return existing;
	try {
		const blob = await fetchImage(url);
		if (!blob) return null;
		const rec: PersonRecord = {
			key,
			accountId,
			address,
			blob,
			sourceUrl: url,
			updatedAt: Date.now()
		};
		const store = await txn(PEOPLE_STORE, 'readwrite');
		await reqAsPromise(store.put(rec));
		return adoptPerson(rec);
	} catch {
		return null;
	}
}

export async function forgetPersonAvatar(accountId: string, address: string): Promise<void> {
	if (!browser) return;
	const key = personKey(accountId, address);
	const previous = personUrls.get(key);
	if (previous) URL.revokeObjectURL(previous);
	personUrls.delete(key);
	personSources.delete(key);
	try {
		const store = await txn(PEOPLE_STORE, 'readwrite');
		await reqAsPromise(store.delete(key));
	} catch {
		return;
	}
}

export function releasePersonAvatars(accountId: string): void {
	for (const [key, url] of personUrls) {
		if (!key.startsWith(`${accountId}\n`)) continue;
		URL.revokeObjectURL(url);
		personUrls.delete(key);
		personSources.delete(key);
	}
}

async function deletePersonRows(accountId: string): Promise<void> {
	const store = await txn(PEOPLE_STORE, 'readwrite');
	const keys = (await reqAsPromise(store.index('byAccount').getAllKeys(accountId))) as string[];
	for (const key of keys ?? []) await reqAsPromise(store.delete(key));
}

export async function forgetAccountAvatar(accountId: string): Promise<void> {
	if (!browser) return;
	const previous = accountUrls.get(accountId);
	if (previous) URL.revokeObjectURL(previous);
	accountUrls.delete(accountId);
	accountSources.delete(accountId);
	releasePersonAvatars(accountId);
	try {
		const store = await txn(ACCOUNT_STORE, 'readwrite');
		await reqAsPromise(store.delete(accountId));
		await deletePersonRows(accountId);
	} catch {
		return;
	}
}

export async function forgetAllAvatars(): Promise<void> {
	if (!browser) return;
	for (const url of accountUrls.values()) URL.revokeObjectURL(url);
	accountUrls.clear();
	accountSources.clear();
	for (const url of personUrls.values()) URL.revokeObjectURL(url);
	personUrls.clear();
	personSources.clear();
	try {
		const accountsStore = await txn(ACCOUNT_STORE, 'readwrite');
		await reqAsPromise(accountsStore.clear());
		const peopleStore = await txn(PEOPLE_STORE, 'readwrite');
		await reqAsPromise(peopleStore.clear());
	} catch {
		return;
	}
}
