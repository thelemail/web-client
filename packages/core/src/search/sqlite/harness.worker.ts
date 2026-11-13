/// <reference lib="webworker" />
import type { Database, SqlValue } from '@thelemail/sqlite-wasm';
import { deleteSearchDb, loadSqlite, openMemorySearchDb, openSearchDb, pauseSearchPool, resumeSearchPool } from './engine';
import type { ParsedQuery } from '../query/ast';
import type { QueryContext } from './compile';
import { QueryEngine, type QueryOptions } from './run';
import type { Coverage, Dimension, SearchDocument, SourceKey, SourceMetadata } from './types';
import { SearchWriter, integrityCheck, maintain, type MaintenanceStep } from './writer';

export type HarnessRequest =
	| { op: 'opfs' }
	| { op: 'open'; directory: string; file: string; key: Uint8Array; rebuild: boolean }
	| { op: 'memory' }
	| { op: 'put'; doc: SearchDocument }
	| { op: 'putBatch'; docs: SearchDocument[] }
	| { op: 'updateMetadata'; key: SourceKey; meta: SourceMetadata }
	| { op: 'setCoverage'; key: SourceKey; dimension: Dimension; state: Coverage }
	| { op: 'delete'; key: SourceKey }
	| { op: 'select'; sql: string; bind?: SqlValue[] }
	| { op: 'exec'; sql: string; bind?: SqlValue[] }
	| { op: 'integrity' }
	| { op: 'maintain'; step: MaintenanceStep }
	| { op: 'stats' }
	| { op: 'close' }
	| { op: 'drop'; directory: string; file: string }
	| { op: 'scan'; directory: string; needles: string[] }
	| { op: 'corrupt'; directory: string }
	| { op: 'query'; token: number; query: ParsedQuery; ctx: QueryContext; options: Omit<QueryOptions, 'signal'> }
	| { op: 'cancel'; token: number }
	| { op: 'page'; session: number; index: number }
	| { op: 'closeQuery'; session: number };

export type HarnessReply = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

let db: Database | null = null;
let writer: SearchWriter | null = null;
let engine: QueryEngine | null = null;
const running = new Map<number, AbortController>();

async function attach(next: Database) {
	db = next;
	writer = new SearchWriter(next);
	engine = new QueryEngine(next, (await loadSqlite()).capi);
	writer.onDelete((source) => engine?.invalidate(source));
}

function close() {
	for (const c of running.values()) c.abort();
	running.clear();
	engine?.dispose();
	writer?.close();
	db?.close();
	engine = null;
	writer = null;
	db = null;
}

async function files(directory: string): Promise<FileSystemFileHandle[]> {
	const root = await navigator.storage.getDirectory();
	const out: FileSystemFileHandle[] = [];
	const walk = async (d: FileSystemDirectoryHandle) => {
		for await (const h of (d as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
			if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle);
			else out.push(h as FileSystemFileHandle);
		}
	};
	await walk(await root.getDirectoryHandle(directory));
	return out;
}

function contains(hay: Uint8Array, needle: Uint8Array): boolean {
	outer: for (let i = 0; i + needle.length <= hay.length; i++) {
		for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
		return true;
	}
	return false;
}

async function scan(directory: string, needles: string[]) {
	close();
	await pauseSearchPool(directory);
	try {
		const encoded = needles.map((n) => [n, new TextEncoder().encode(n)] as const);
		const found = new Set<string>();
		let bytes = 0;
		for (const handle of await files(directory)) {
			const data = new Uint8Array(await (await handle.getFile()).arrayBuffer());
			bytes += data.length;
			for (const [n, e] of encoded) if (contains(data, e)) found.add(n);
		}
		return { bytes, found: [...found] };
	} finally {
		await resumeSearchPool(directory);
	}
}

async function corrupt(directory: string) {
	close();
	await pauseSearchPool(directory);
	try {
		let largest: { handle: FileSystemFileHandle; size: number } | null = null;
		for (const handle of await files(directory)) {
			const size = (await handle.getFile()).size;
			if (!largest || size > largest.size) largest = { handle, size };
		}
		if (!largest) throw new Error('no files');
		const access = await largest.handle.createSyncAccessHandle();
		try {
			access.write(crypto.getRandomValues(new Uint8Array(512)), { at: 4096 + 4096 + 1024 });
			access.flush();
		} finally {
			access.close();
		}
	} finally {
		await resumeSearchPool(directory);
	}
}

async function handle(r: HarnessRequest): Promise<unknown> {
	switch (r.op) {
		case 'opfs':
			return typeof FileSystemFileHandle !== 'undefined' && 'createSyncAccessHandle' in FileSystemFileHandle.prototype
				? await navigator.storage.getDirectory().then(
						() => true,
						() => false
					)
				: false;
		case 'open': {
			close();
			const result = await openSearchDb(r);
			if (!result.ok) return { ok: false, code: result.code };
			await attach(result.db);
			return { ok: true, rebuilt: result.rebuilt };
		}
		case 'memory':
			close();
			await attach(await openMemorySearchDb());
			return null;
		case 'put':
			return writer!.put(r.doc);
		case 'putBatch':
			return writer!.putBatch(r.docs);
		case 'updateMetadata':
			return writer!.updateMetadata(r.key, r.meta);
		case 'setCoverage':
			return writer!.setCoverage(r.key, r.dimension, r.state);
		case 'delete':
			return writer!.delete(r.key);
		case 'select':
			return db!.selectArrays(r.sql, r.bind);
		case 'exec':
			db!.exec({ sql: r.sql, bind: r.bind });
			return null;
		case 'integrity':
			return integrityCheck(db!);
		case 'maintain':
			return maintain(db!, r.step);
		case 'stats': {
			const sqlite = await loadSqlite();
			return { heap: sqlite.wasm.heap8u().byteLength };
		}
		case 'close':
			close();
			return null;
		case 'drop':
			close();
			return deleteSearchDb(r.directory, r.file);
		case 'scan':
			return scan(r.directory, r.needles);
		case 'corrupt':
			return corrupt(r.directory);
		case 'query': {
			const controller = new AbortController();
			running.set(r.token, controller);
			try {
				return await engine!.run(r.query, r.ctx, { ...r.options, signal: controller.signal });
			} catch (err) {
				if (controller.signal.aborted) return { cancelled: true };
				throw err;
			} finally {
				running.delete(r.token);
			}
		}
		case 'cancel':
			running.get(r.token)?.abort();
			return null;
		case 'page':
			return engine!.page(r.session, r.index);
		case 'closeQuery':
			engine!.close(r.session);
			return null;
	}
}

self.onmessage = async (e: MessageEvent<HarnessRequest & { id: number }>) => {
	const { id } = e.data;
	try {
		self.postMessage({ id, ok: true, value: await handle(e.data) } satisfies HarnessReply);
	} catch (err) {
		self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies HarnessReply);
	}
};
