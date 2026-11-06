import { base64ToBytes } from '../../keystore/opaque-params';
import { AUTH_VAULT_WRAP_INFO, WRAP_KEY_BYTES } from '../../keystore/vault-wrap';
import type { VaultDeviceKeys } from '../types';

const DB_NAME = 'thelemail-auth-device';
const STORE = 'keys';
export const PRUNE_GRACE_MS = 60_000;

interface DeviceKeyRecord {
	accountId: string;
	key: CryptoKey;
	createdAt: number;
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

export function createVaultDeviceKeys(now: () => number = Date.now): VaultDeviceKeys {
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
			const rec: DeviceKeyRecord = { accountId, key, createdAt: now() };
			await withStore('readwrite', (s) => s.put(rec));
		},

		async deriveWrapKey(accountId, serverHalf) {
			const rec = await withStore<DeviceKeyRecord | undefined>('readonly', (s) => s.get(accountId));
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

		async remove(accountId) {
			await withStore('readwrite', (s) => s.delete(accountId));
		},

		async removeAll() {
			await withStore('readwrite', (s) => s.clear());
		},

		async prune(keep) {
			const all = await withStore<DeviceKeyRecord[]>('readonly', (s) => s.getAll());
			const cutoff = now() - PRUNE_GRACE_MS;
			for (const rec of all) {
				if (!keep.has(rec.accountId) && rec.createdAt < cutoff) {
					await withStore('readwrite', (s) => s.delete(rec.accountId));
				}
			}
		}
	};
}
