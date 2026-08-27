import { openDb, VAULT_STORE, ACCOUNTS_STORE } from '$lib/idb';

export interface VaultRecord {
	accountId: string;
	email: string;
	authScheme: 'srp_v1' | 'opaque_v1';
	srpSalt?: string;
	keySalt?: string;
	wrappedMasterKey?: string;
	masterKeyId?: string;
	opaqueParamsVersion?: number;
	armoredEncryptedPrivateKey: string;
	updatedAt: number;
	wrappedPrivateKey?: Uint8Array;
	wrapIv?: Uint8Array;
	localHalfKey?: CryptoKey;
	wrapPayloadVersion?: 1 | 2;
}

export interface AccountSlotRecord {
	accountId: string;
	slot: number;
	email: string;
	addedAt: number;
	lastActiveAt: number;
}

function vaultTxn(mode: IDBTransactionMode): Promise<IDBObjectStore> {
	return openDb().then((db) => db.transaction(VAULT_STORE, mode).objectStore(VAULT_STORE));
}

function accountsTxn(mode: IDBTransactionMode): Promise<IDBObjectStore> {
	return openDb().then((db) => db.transaction(ACCOUNTS_STORE, mode).objectStore(ACCOUNTS_STORE));
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function getVault(accountId: string): Promise<VaultRecord | null> {
	const store = await vaultTxn('readonly');
	const v = await reqAsPromise(store.get(accountId));
	return (v as VaultRecord | undefined) ?? null;
}

export async function getAllVaults(): Promise<VaultRecord[]> {
	const store = await vaultTxn('readonly');
	const all = await reqAsPromise(store.getAll());
	return (all ?? []) as VaultRecord[];
}

export async function putVault(v: VaultRecord): Promise<void> {
	const store = await vaultTxn('readwrite');
	await reqAsPromise(store.put(v));
}

export async function deleteVault(accountId: string): Promise<void> {
	const store = await vaultTxn('readwrite');
	await reqAsPromise(store.delete(accountId));
}

export async function clearAllVaults(): Promise<void> {
	const store = await vaultTxn('readwrite');
	await reqAsPromise(store.clear());
}

export async function getAllAccountSlots(): Promise<AccountSlotRecord[]> {
	const store = await accountsTxn('readonly');
	const all = await reqAsPromise(store.getAll());
	return (all ?? []) as AccountSlotRecord[];
}

export async function putAccountSlot(rec: AccountSlotRecord): Promise<void> {
	const store = await accountsTxn('readwrite');
	await reqAsPromise(store.put(rec));
}

export async function deleteAccountSlot(accountId: string): Promise<void> {
	const store = await accountsTxn('readwrite');
	await reqAsPromise(store.delete(accountId));
}

export async function clearAllAccountSlots(): Promise<void> {
	const store = await accountsTxn('readwrite');
	await reqAsPromise(store.clear());
}
