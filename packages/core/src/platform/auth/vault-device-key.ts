import { base64ToBytes } from '../../keystore/opaque-params';
import { AUTH_VAULT_WRAP_INFO, WRAP_KEY_BYTES } from '../../keystore/vault-wrap';
import type { VaultDeviceKeys } from '../types';

const DB_NAME = 'thelemail-auth-device';
const STORE = 'keys';
export const PRUNE_GRACE_MS = 60_000;

export interface DeviceKeyRecord {
	accountId: string;
	key: CryptoKey;
	createdAt: number;
}

export interface DeviceKeyStore {
	get(accountId: string): Promise<DeviceKeyRecord | undefined>;
	getAll(): Promise<DeviceKeyRecord[]>;
	put(rec: DeviceKeyRecord): Promise<void>;
	delete(accountId: string): Promise<void>;
	clear(): Promise<void>;
}

const info = new TextEncoder().encode(AUTH_VAULT_WRAP_INFO);

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STORE, { keyPath: 'accountId' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
		req.onblocked = () => reject(new Error('device key store blocked'));
	});
}

async function withStore<T>(
	mode: IDBTransactionMode,
	fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const db = await openDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(STORE, mode);
			const req = fn(tx.objectStore(STORE));
			let result: T;
			req.onsuccess = () => {
				result = req.result;
			};
			tx.oncomplete = () => resolve(result);
			tx.onerror = () => reject(tx.error ?? req.error);
			tx.onabort = () => reject(tx.error ?? new Error('device key store aborted'));
		});
	} finally {
		db.close();
	}
}

export const idbDeviceKeyStore: DeviceKeyStore = {
	get: (accountId) =>
		withStore<DeviceKeyRecord | undefined>('readonly', (s) => s.get(accountId)),
	getAll: () => withStore<DeviceKeyRecord[]>('readonly', (s) => s.getAll()),
	put: async (rec) => {
		await withStore('readwrite', (s) => s.put(rec));
	},
	delete: async (accountId) => {
		await withStore('readwrite', (s) => s.delete(accountId));
	},
	clear: async () => {
		await withStore('readwrite', (s) => s.clear());
	}
};

export function createVaultDeviceKeys(
	store: DeviceKeyStore = idbDeviceKeyStore,
	now: () => number = Date.now
): VaultDeviceKeys {
	return {
		async create(accountId) {
			const ikm = crypto.getRandomValues(new Uint8Array(WRAP_KEY_BYTES));
			let key: CryptoKey;
			try {
				key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
					'deriveBits'
				]);
			} finally {
				ikm.fill(0);
			}
			await store.put({ accountId, key, createdAt: now() });
		},

		async deriveWrapKey(accountId, serverHalf) {
			const rec = await store.get(accountId);
			if (!rec) return null;
			const salt = base64ToBytes(serverHalf);
			try {
				return await crypto.subtle.deriveBits(
					{ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
					rec.key,
					WRAP_KEY_BYTES * 8
				);
			} finally {
				salt.fill(0);
			}
		},

		remove: (accountId) => store.delete(accountId),

		removeAll: () => store.clear(),

		async prune(keep) {
			const cutoff = now() - PRUNE_GRACE_MS;
			for (const rec of await store.getAll()) {
				if (!keep.has(rec.accountId) && rec.createdAt < cutoff) {
					await store.delete(rec.accountId);
				}
			}
		}
	};
}
