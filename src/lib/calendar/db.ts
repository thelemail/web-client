import type { CalendarItemRow, CalendarItemStateRow, CalendarRow } from '$lib/api/calendars';
import type { ItemKind } from './model';
import type { OutboxOp, OutboxStatus } from './outbox';
import { openDatabase } from '$lib/idb-open';

export interface CachedCalendar {
	accountId: string;
	id: string;
	row: CalendarRow;
}

export interface CachedItem {
	accountId: string;
	id: string;
	calendarId: string;
	row: CalendarItemRow;
	uid?: string;
	kind?: ItemKind;
	spanStart?: number;
	spanEnd?: number | null;
	pending?: boolean;
}

export interface CachedState {
	accountId: string;
	itemId: string;
	row: CalendarItemStateRow;
}

export interface SyncState {
	accountId: string;
	cursor: string | null;
	lastSyncAt: number | null;
	loaded: boolean;
}

export interface OutboxRecord {
	seq: number;
	accountId: string;
	op: OutboxOp;
	status: OutboxStatus;
	attempts: number;
	lastError?: string;
	createdAt: number;
	conflict?: { serverRev: number };
}

export interface CalendarDb {
	calendars(accountId: string): Promise<CachedCalendar[]>;
	putCalendar(row: CachedCalendar): Promise<void>;
	deleteCalendar(accountId: string, id: string): Promise<void>;
	items(accountId: string): Promise<CachedItem[]>;
	putItem(row: CachedItem): Promise<void>;
	putItems(rows: CachedItem[]): Promise<void>;
	deleteItem(accountId: string, id: string): Promise<void>;
	states(accountId: string): Promise<CachedState[]>;
	putState(row: CachedState): Promise<void>;
	sync(accountId: string): Promise<SyncState | null>;
	putSync(state: SyncState): Promise<void>;
	outbox(accountId: string): Promise<OutboxRecord[]>;
	enqueue(record: Omit<OutboxRecord, 'seq'>): Promise<OutboxRecord>;
	updateOutbox(record: OutboxRecord): Promise<void>;
	removeOutbox(seq: number): Promise<void>;
	clear(accountId: string): Promise<void>;
}

const DB_NAME = 'thelemail-calendar';
const DB_VERSION = 1;
const CALENDARS = 'calendars';
const ITEMS = 'items';
const STATES = 'states';
const SYNC = 'sync';
const OUTBOX = 'outbox';
const BY_ACCOUNT = 'byAccount';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = openDatabase(DB_NAME, DB_VERSION, (db) => {
		if (!db.objectStoreNames.contains(CALENDARS)) {
			db.createObjectStore(CALENDARS, { keyPath: ['accountId', 'id'] }).createIndex(
				BY_ACCOUNT,
				'accountId'
			);
		}
		if (!db.objectStoreNames.contains(ITEMS)) {
			db.createObjectStore(ITEMS, { keyPath: ['accountId', 'id'] }).createIndex(
				BY_ACCOUNT,
				'accountId'
			);
		}
		if (!db.objectStoreNames.contains(STATES)) {
			db.createObjectStore(STATES, { keyPath: ['accountId', 'itemId'] }).createIndex(
				BY_ACCOUNT,
				'accountId'
			);
		}
		if (!db.objectStoreNames.contains(SYNC)) {
			db.createObjectStore(SYNC, { keyPath: 'accountId' });
		}
		if (!db.objectStoreNames.contains(OUTBOX)) {
			db.createObjectStore(OUTBOX, { keyPath: 'seq', autoIncrement: true }).createIndex(
				BY_ACCOUNT,
				'accountId'
			);
		}
	})
		.then((db) => {
			db.onclose = () => {
				dbPromise = null;
			};
			return db;
		})
		.catch((err) => {
			dbPromise = null;
			throw err;
		});
	return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

async function allByAccount<T>(store: string, accountId: string): Promise<T[]> {
	const db = await openDb();
	const tx = db.transaction(store, 'readonly');
	return request(tx.objectStore(store).index(BY_ACCOUNT).getAll(accountId)) as Promise<T[]>;
}

async function put(store: string, value: unknown): Promise<void> {
	const db = await openDb();
	const tx = db.transaction(store, 'readwrite');
	tx.objectStore(store).put(value);
	await done(tx);
}

async function remove(store: string, key: IDBValidKey): Promise<void> {
	const db = await openDb();
	const tx = db.transaction(store, 'readwrite');
	tx.objectStore(store).delete(key);
	await done(tx);
}

async function clearAccount(store: string, accountId: string): Promise<void> {
	const db = await openDb();
	const tx = db.transaction(store, 'readwrite');
	const idx = tx.objectStore(store).index(BY_ACCOUNT);
	const keys = await request(idx.getAllKeys(accountId));
	for (const key of keys) tx.objectStore(store).delete(key);
	await done(tx);
}

export const idbCalendarDb: CalendarDb = {
	calendars: (accountId) => allByAccount<CachedCalendar>(CALENDARS, accountId),
	putCalendar: (row) => put(CALENDARS, row),
	deleteCalendar: (accountId, id) => remove(CALENDARS, [accountId, id]),
	items: (accountId) => allByAccount<CachedItem>(ITEMS, accountId),
	putItem: (row) => put(ITEMS, row),
	async putItems(rows) {
		if (!rows.length) return;
		const db = await openDb();
		const tx = db.transaction(ITEMS, 'readwrite');
		for (const row of rows) tx.objectStore(ITEMS).put(row);
		await done(tx);
	},
	deleteItem: (accountId, id) => remove(ITEMS, [accountId, id]),
	states: (accountId) => allByAccount<CachedState>(STATES, accountId),
	putState: (row) => put(STATES, row),
	async sync(accountId) {
		const db = await openDb();
		const tx = db.transaction(SYNC, 'readonly');
		const state = (await request(tx.objectStore(SYNC).get(accountId))) as SyncState | undefined;
		return state ?? null;
	},
	putSync: (state) => put(SYNC, state),
	async outbox(accountId) {
		const rows = await allByAccount<OutboxRecord>(OUTBOX, accountId);
		return rows.sort((a, b) => a.seq - b.seq);
	},
	async enqueue(record) {
		const db = await openDb();
		const tx = db.transaction(OUTBOX, 'readwrite');
		const key = await request(tx.objectStore(OUTBOX).add(record));
		await done(tx);
		return { ...record, seq: key as number };
	},
	updateOutbox: (record) => put(OUTBOX, record),
	removeOutbox: (seq) => remove(OUTBOX, seq),
	async clear(accountId) {
		await Promise.all([
			clearAccount(CALENDARS, accountId),
			clearAccount(ITEMS, accountId),
			clearAccount(STATES, accountId),
			clearAccount(OUTBOX, accountId),
			remove(SYNC, accountId)
		]);
	}
};

export function memoryCalendarDb(): CalendarDb {
	const calendars = new Map<string, CachedCalendar>();
	const items = new Map<string, CachedItem>();
	const states = new Map<string, CachedState>();
	const sync = new Map<string, SyncState>();
	const outbox = new Map<number, OutboxRecord>();
	let seq = 0;
	const key = (a: string, b: string) => `${a} ${b}`;
	return {
		async calendars(accountId) {
			return [...calendars.values()].filter((c) => c.accountId === accountId);
		},
		async putCalendar(row) {
			calendars.set(key(row.accountId, row.id), row);
		},
		async deleteCalendar(accountId, id) {
			calendars.delete(key(accountId, id));
		},
		async items(accountId) {
			return [...items.values()].filter((i) => i.accountId === accountId);
		},
		async putItem(row) {
			items.set(key(row.accountId, row.id), row);
		},
		async putItems(rows) {
			for (const row of rows) items.set(key(row.accountId, row.id), row);
		},
		async deleteItem(accountId, id) {
			items.delete(key(accountId, id));
		},
		async states(accountId) {
			return [...states.values()].filter((s) => s.accountId === accountId);
		},
		async putState(row) {
			states.set(key(row.accountId, row.itemId), row);
		},
		async sync(accountId) {
			return sync.get(accountId) ?? null;
		},
		async putSync(state) {
			sync.set(state.accountId, state);
		},
		async outbox(accountId) {
			return [...outbox.values()]
				.filter((o) => o.accountId === accountId)
				.sort((a, b) => a.seq - b.seq);
		},
		async enqueue(record) {
			seq += 1;
			const stored = { ...record, seq };
			outbox.set(seq, stored);
			return stored;
		},
		async updateOutbox(record) {
			outbox.set(record.seq, record);
		},
		async removeOutbox(s) {
			outbox.delete(s);
		},
		async clear(accountId) {
			for (const [k, v] of calendars) if (v.accountId === accountId) calendars.delete(k);
			for (const [k, v] of items) if (v.accountId === accountId) items.delete(k);
			for (const [k, v] of states) if (v.accountId === accountId) states.delete(k);
			for (const [k, v] of outbox) if (v.accountId === accountId) outbox.delete(k);
			sync.delete(accountId);
		}
	};
}
