import type { Database, SAHPoolUtil, Sqlite3Static } from '@thelemail/sqlite-wasm';
import wasmUrl from '@thelemail/sqlite-wasm/sqlite3.wasm?url';
import { inspect, migrate } from './schema';

const CIPHER = 'chacha20';
const KEY_BYTES = 32;
const CACHE_KIB = 16 * 1024;
const RAW_PREFIX = new TextEncoder().encode('raw:');

export type OpenFailure = 'unreadable' | 'no-opfs' | 'unavailable' | 'bad-key';

export type OpenResult =
	| { ok: true; db: Database; rebuilt: boolean }
	| { ok: false; code: OpenFailure };

export interface OpenOptions {
	directory: string;
	file: string;
	key: Uint8Array;
	rebuild: boolean;
}

let modulePromise: Promise<Sqlite3Static> | null = null;
const pools = new Map<string, Promise<SAHPoolUtil>>();

export function loadSqlite(): Promise<Sqlite3Static> {
	modulePromise ??= import('@thelemail/sqlite-wasm')
		.then(({ default: init }) =>
			init({
				print: () => {},
				printErr: () => {},
				locateFile: () => wasmUrl
			})
		)
		.catch((err) => {
			modulePromise = null;
			throw err;
		});
	return modulePromise;
}

function opfsAvailable(): boolean {
	return (
		typeof FileSystemFileHandle !== 'undefined' &&
		'createSyncAccessHandle' in FileSystemFileHandle.prototype &&
		typeof navigator !== 'undefined' &&
		typeof navigator.storage?.getDirectory === 'function'
	);
}

function vfsName(directory: string): string {
	return `search-${directory}`;
}

async function pool(sqlite: Sqlite3Static, directory: string): Promise<SAHPoolUtil> {
	let p = pools.get(directory);
	if (!p) {
		p = sqlite.installOpfsSAHPoolVfs({ name: vfsName(directory), directory: `/${directory}` }).then((util) => {
			const name = vfsName(directory);
			if (!sqlite.capi.sqlite3_vfs_find(`multipleciphers-${name}`)) {
				const rc = sqlite.capi.sqlite3mc_vfs_create(name, 0);
				if (rc !== sqlite.capi.SQLITE_OK) throw new Error(sqlite.capi.sqlite3_errstr(rc));
			}
			return util;
		});
		p.catch(() => pools.delete(directory));
		pools.set(directory, p);
	}
	return p;
}

function applyKey(sqlite: Sqlite3Static, pDb: number, key: Uint8Array): number {
	const n = RAW_PREFIX.length + key.length;
	const p = sqlite.wasm.alloc(n);
	try {
		const heap = sqlite.wasm.heap8u();
		heap.set(RAW_PREFIX, p);
		heap.set(key, p + RAW_PREFIX.length);
		return sqlite.capi.sqlite3_key_v2(pDb, 'main', p, n);
	} finally {
		sqlite.wasm.heap8u().fill(0, p, p + n);
		sqlite.wasm.dealloc(p);
	}
}

function configure(db: Database): void {
	db.exec(`PRAGMA cache_size = -${CACHE_KIB}`);
	db.exec('PRAGMA temp_store = MEMORY');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec('PRAGMA secure_delete = ON');
}

function openKeyed(sqlite: Sqlite3Static, directory: string, file: string, key: Uint8Array): Database | null {
	const { capi, wasm } = sqlite;
	const stack = wasm.pstack.pointer;
	let pDb = 0;
	try {
		const ppDb = wasm.pstack.allocPtr();
		const flags = capi.SQLITE_OPEN_READWRITE | capi.SQLITE_OPEN_CREATE | capi.SQLITE_OPEN_EXRESCODE;
		const rc = capi.sqlite3_open_v2(file, ppDb, flags, `multipleciphers-${vfsName(directory)}`);
		pDb = wasm.peekPtr(ppDb);
		if (rc !== capi.SQLITE_OK) throw new Error(capi.sqlite3_errstr(rc));
		const cipher = capi.sqlite3mc_cipher_index(CIPHER);
		if (capi.sqlite3mc_config(pDb, 'cipher', cipher) !== cipher) throw new Error('cipher');
		if (applyKey(sqlite, pDb, key) !== capi.SQLITE_OK) throw new Error('key');
		const db = sqlite.oo1.DB.wrapHandle(pDb, true);
		pDb = 0;
		try {
			db.selectValue('SELECT count(*) FROM sqlite_schema');
		} catch {
			db.close();
			return null;
		}
		return db;
	} finally {
		if (pDb) capi.sqlite3_close_v2(pDb);
		wasm.pstack.restore(stack);
	}
}

function healthy(db: Database): boolean {
	try {
		return db.selectValue('PRAGMA quick_check') === 'ok';
	} catch {
		return false;
	}
}

function prepare(db: Database): 'ready' | 'migrated' | 'incompatible' {
	const state = inspect(db);
	if (state.kind === 'incompatible') return 'incompatible';
	if (state.kind === 'current') return healthy(db) ? 'ready' : 'incompatible';
	migrate(db, state.kind === 'empty' ? 0 : state.version);
	return 'migrated';
}

export async function openSearchDb(options: OpenOptions): Promise<OpenResult> {
	if (options.key.length !== KEY_BYTES) return { ok: false, code: 'bad-key' };
	if (!opfsAvailable()) return { ok: false, code: 'no-opfs' };
	let sqlite: Sqlite3Static;
	let util: SAHPoolUtil;
	try {
		sqlite = await loadSqlite();
		util = await pool(sqlite, options.directory);
		if (util.isPaused()) await util.unpauseVfs();
	} catch {
		return { ok: false, code: 'unavailable' };
	}
	const first = openKeyed(sqlite, options.directory, options.file, options.key);
	if (first) {
		let outcome: ReturnType<typeof prepare>;
		try {
			outcome = prepare(first);
		} catch {
			outcome = 'incompatible';
		}
		if (outcome !== 'incompatible') return { ok: true, db: configured(first), rebuilt: false };
		first.close();
	}
	if (!options.rebuild) return { ok: false, code: 'unreadable' };
	util.unlink(options.file);
	const fresh = openKeyed(sqlite, options.directory, options.file, options.key);
	if (!fresh) return { ok: false, code: 'unavailable' };
	migrate(fresh, 0);
	return { ok: true, db: configured(fresh), rebuilt: true };
}

function configured(db: Database): Database {
	configure(db);
	return db;
}

export async function openMemorySearchDb(): Promise<Database> {
	const sqlite = await loadSqlite();
	const db = new sqlite.oo1.DB(':memory:', 'c');
	migrate(db, 0);
	return configured(db);
}

export async function deleteSearchDb(directory: string, file: string): Promise<boolean> {
	const sqlite = await loadSqlite();
	return (await pool(sqlite, directory)).unlink(file);
}

export async function pauseSearchPool(directory: string): Promise<void> {
	const util = await pools.get(directory)?.catch(() => null);
	if (util && !util.isPaused()) util.pauseVfs();
}

export async function resumeSearchPool(directory: string): Promise<void> {
	const util = await pools.get(directory)?.catch(() => null);
	if (util?.isPaused()) await util.unpauseVfs();
}

export async function wipeSearchPool(directory: string): Promise<void> {
	const p = pools.get(directory);
	if (!p) return;
	pools.delete(directory);
	const util = await p.catch(() => null);
	if (!util) return;
	const sqlite = await loadSqlite();
	sqlite.capi.sqlite3mc_vfs_destroy(`multipleciphers-${vfsName(directory)}`);
	await util.removeVfs();
}
