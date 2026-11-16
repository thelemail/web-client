/// <reference lib="webworker" />
import type { Database } from '@thelemail/sqlite-wasm';
import type {
	DeriveSearchDbKeyResponse,
	SearchSessionCommand,
	SearchSessionRequest,
	SearchSessionResponse
} from '../../keystore/protocol';
import { deleteSearchDb, loadSqlite, openMemorySearchDb, openSearchDb, pauseSearchPool, pruneSearchDb, wipeSearchPool } from '../sqlite/engine';
import { SearchHistory, historyKey } from '../sqlite/history';
import { QueryEngine, yieldTask } from '../sqlite/run';
import { SearchWriter, maintain } from '../sqlite/writer';
import { Batch } from './batch';
import { Bridge, type BridgeCaller } from '../sync/bridge';
import { Extractor, type ExtractorPort } from '../sync/extractor';
import type { SyncProgress } from '../sync/jobs';
import { SyncStore } from '../sync/store';
import {
	directoryFor,
	fileFor,
	type ClientRequest,
	type ControlRequest,
	type InitResult,
	type Mode,
	type Persistence,
	type ProgressEvent,
	type QueryReply,
	type Reply,
	type SearchStatus,
	type StatusEvent,
	type SyncStatus
} from './protocol';
import { admit, requestPersistence } from './quota';
import { Scheduler, type Job, type JobClass } from './scheduler';

const KEY_TIMEOUT_MS = 10_000;
const MAX_SESSIONS_PER_CLIENT = 4;
const HEAVY: readonly JobClass[] = ['body', 'attachments', 'embeddings'];

export interface JobContext {
	readonly db: Database;
	readonly writer: SearchWriter;
	readonly store: SyncStore;
	readonly bridge: BridgeCaller | null;
	readonly extractor: ExtractorPort;
	readonly progress: SyncProgress;
	batch(job: string): Batch;
	wake(job?: string): void;
	later(job: string, ms: number): void;
	now(): number;
}

export interface ServeOptions {
	extractor?: () => ExtractorPort;
}

function defaultExtractor(): ExtractorPort {
	return new Extractor(() => new Worker(new URL('../extract/extract.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-search-extract' }));
}

export type JobFactory = (ctx: JobContext) => Job;

interface Client {
	sessions: number[];
	running: Map<number, AbortController>;
}

interface Open {
	db: Database;
	writer: SearchWriter;
	store: SyncStore;
	bridge: Bridge | null;
	extractor: ExtractorPort;
	progress: SyncProgress;
	timers: Map<string, ReturnType<typeof setTimeout>>;
	engine: QueryEngine;
	scheduler: Scheduler;
	persistence: Persistence;
	mode: Mode;
	history: SearchHistory | null;
	directory: string | null;
	file: string | null;
	sources: number;
	sync: SyncStatus | null;
}

function sessionCall<T>(port: MessagePort, cmd: SearchSessionCommand, args: unknown): Promise<T | null> {
	return new Promise((resolve) => {
		const id = crypto.randomUUID();
		const finish = (value: T | null) => {
			clearTimeout(timer);
			port.removeEventListener('message', listener);
			resolve(value);
		};
		const listener = (e: MessageEvent<SearchSessionResponse>) => {
			if (e.data?.type === 'response' && e.data.id === id) finish(e.data.value as T);
		};
		const timer = setTimeout(() => finish(null), KEY_TIMEOUT_MS);
		port.addEventListener('message', listener);
		port.start();
		port.postMessage({ id, cmd, args } satisfies SearchSessionRequest);
	});
}

export const maintenanceJob: JobFactory = ({ db }) => ({
	name: 'maintenance',
	class: 'maintenance',
	step: async () => (maintain(db, 'merge') ? 'more' : 'idle')
});

export function serve(scope: DedicatedWorkerGlobalScope, factories: readonly JobFactory[], options: ServeOptions = {}): void {
	let open: Open | null = null;
	let keystore: MessagePort | null = null;
	let installationSalt: Uint8Array | null = null;
	const clients = new Map<MessagePort, Client>();
	const inflight = new Set<Promise<unknown>>();

	function status(): SearchStatus {
		const o = open!;
		return {
			persistence: o.persistence,
			mode: o.mode,
			limited: o.persistence === 'session' ? 'session' : o.scheduler.blocked ? 'quota' : null,
			sources: o.sources,
			working: o.scheduler.working,
			paused: o.scheduler.paused,
			generation: o.engine.generation,
			sync: o.sync
		};
	}

	function count(o: Open): void {
		o.sources = Number(o.db.selectValue('SELECT count(*) FROM sources'));
		o.sync = o.bridge ? { ...o.progress, queue: o.store.counts(), coverage: o.store.coverage() } : null;
	}

	function publish(): void {
		if (!open) return;
		if (!open.scheduler.working) count(open);
		const event: StatusEvent = { type: 'status', status: status() };
		for (const port of clients.keys()) port.postMessage(event);
	}

	async function attach(
		db: Database,
		persistence: Persistence,
		mode: Mode,
		directory: string | null,
		file: string | null,
		port: MessagePort | undefined,
		paused: boolean
	): Promise<void> {
		const sqlite = await loadSqlite();
		const writer = new SearchWriter(db);
		const engine = new QueryEngine(db, sqlite.capi);
		writer.onDelete((source) => engine.invalidate(source));
		const scheduler = new Scheduler({ yieldTask, onChange: publish });
		const bridge = port ? new Bridge(port) : null;
		const timers = new Map<string, ReturnType<typeof setTimeout>>();
		const o: Open = {
			db,
			writer,
			store: new SyncStore(db),
			bridge,
			extractor: (options.extractor ?? defaultExtractor)(),
			progress: { phase: null, seq: null, syncedAt: null, waiting: null },
			timers,
			engine,
			scheduler,
			persistence,
			mode,
			history: null,
			directory,
			file,
			sources: 0,
			sync: null
		};
		open = o;
		writer.onInsert(() => {
			if (o.progress.phase === 'live') engine.generation++;
		});
		count(o);
		const admission = persistence === 'session' ? async () => ({ ok: true }) as const : admit;
		const ctx: JobContext = {
			db,
			writer,
			store: o.store,
			bridge,
			extractor: o.extractor,
			progress: o.progress,
			batch: (job) => new Batch(writer, job, admission, () => scheduler.wake('maintenance')),
			wake: (job) => scheduler.wake(job),
			later: (job, ms) => {
				const existing = timers.get(job);
				if (existing !== undefined) clearTimeout(existing);
				timers.set(
					job,
					setTimeout(() => {
						timers.delete(job);
						scheduler.wake(job);
					}, Math.max(0, ms))
				);
			},
			now: () => Date.now()
		};
		for (const factory of factories) {
			const job = factory(ctx);
			if (mode === 'preview' && HEAVY.includes(job.class)) continue;
			scheduler.register(job);
		}
		if (paused) scheduler.pause(HEAVY);
	}

	async function init(r: Extract<ControlRequest, { op: 'init' }>): Promise<InitResult> {
		if (open) await close(false);
		keystore = r.keystore;
		installationSalt = r.installationSalt.slice();
		const derived = await sessionCall<DeriveSearchDbKeyResponse>(keystore, 'deriveSearchDbKey', {
			installationSalt: r.installationSalt
		});
		if (!derived?.ok) return { ok: false, code: 'locked' };
		const directory = directoryFor(r.accountId);
		const file = fileFor(r.generationId);
		let result: Awaited<ReturnType<typeof openSearchDb>>;
		try {
			result = await openSearchDb({ directory, file, key: derived.key, rebuild: true });
		} finally {
			derived.key.fill(0);
		}
		if (result.ok) {
			await attach(result.db, 'persistent', 'saved', directory, file, r.bridge, r.paused);
			void requestPersistence();
			await pruneSearchDb(directory, file).catch(() => undefined);
			return { ok: true, status: status(), rebuilt: result.rebuilt };
		}
		if (result.code === 'bad-key') return { ok: false, code: 'failed' };
		return memory(r.bridge, 'saved', r.paused, true);
	}

	async function memory(bridge: MessagePort | undefined, mode: Mode, paused: boolean, keepKeystore = false): Promise<InitResult> {
		if (open) await close(false, keepKeystore);
		try {
			await attach(await openMemorySearchDb(), 'session', mode, null, null, bridge, paused);
		} catch {
			return { ok: false, code: 'failed' };
		}
		return { ok: true, status: status(), rebuilt: false };
	}

	async function close(wipe: boolean, keepKeystore = false): Promise<void> {
		const o = open;
		open = null;
		for (const [port, client] of clients) {
			for (const c of client.running.values()) c.abort();
			port.close();
		}
		clients.clear();
		if (keystore && !keepKeystore) {
			keystore.postMessage({ id: crypto.randomUUID(), cmd: 'closeSearchSession' } satisfies SearchSessionRequest);
			keystore.close();
			keystore = null;
			installationSalt?.fill(0);
			installationSalt = null;
		}
		if (!o) return;
		for (const t of o.timers.values()) clearTimeout(t);
		o.timers.clear();
		o.bridge?.close();
		o.extractor.close();
		await Promise.all(inflight);
		await o.scheduler.stop();
		o.engine.dispose();
		o.writer.close();
		o.db.close();
		if (!o.directory || !o.file) return;
		if (wipe) {
			await deleteSearchDb(o.directory, o.file).catch(() => false);
			await wipeSearchPool(o.directory).catch(() => undefined);
		} else {
			await pauseSearchPool(o.directory);
		}
	}

	function drop(port: MessagePort): void {
		const client = clients.get(port);
		if (!client) return;
		for (const c of client.running.values()) c.abort();
		for (const id of client.sessions) open?.engine.close(id);
		clients.delete(port);
		port.close();
	}

	async function history(o: Open): Promise<SearchHistory | null> {
		if (o.history) return o.history;
		if (o.persistence !== 'persistent' || !keystore || !installationSalt) return null;
		const derived = await sessionCall<DeriveSearchDbKeyResponse>(keystore, 'deriveSearchHistoryKey', { installationSalt });
		if (!derived?.ok || open !== o) {
			if (derived?.ok) derived.key.fill(0);
			return null;
		}
		o.history = new SearchHistory(o.db, await historyKey(derived.key));
		return o.history;
	}

	async function query(port: MessagePort, client: Client, r: Extract<ClientRequest, { op: 'query' }>): Promise<QueryReply> {
		const o = open!;
		const controller = new AbortController();
		client.running.set(r.token, controller);
		const onProgress = (progress: ProgressEvent['progress']) => {
			if (clients.has(port) && !controller.signal.aborted) port.postMessage({ type: 'progress', token: r.token, progress } satisfies ProgressEvent);
		};
		try {
			const running = o.scheduler.foreground(() => o.engine.run(r.query, r.ctx, { ...r.options, signal: controller.signal, onProgress }));
			const settled: Promise<boolean> = running.then(
				() => inflight.delete(settled),
				() => inflight.delete(settled)
			);
			inflight.add(settled);
			const outcome = await running;
			if (outcome.ok) {
				client.sessions.push(outcome.summary.id);
				while (client.sessions.length > MAX_SESSIONS_PER_CLIENT) o.engine.close(client.sessions.shift()!);
			}
			return outcome;
		} catch (error) {
			if (controller.signal.aborted) return { ok: false, cancelled: true };
			throw error;
		} finally {
			client.running.delete(r.token);
		}
	}

	async function answer(port: MessagePort, client: Client, r: ClientRequest): Promise<unknown> {
		if (!open) throw new Error('closed');
		switch (r.op) {
			case 'query':
				return query(port, client, r);
			case 'cancel':
				client.running.get(r.token)?.abort();
				return null;
			case 'page':
				if (!client.sessions.includes(r.session)) return { ok: false, reason: 'closed' };
				return open.engine.page(r.session, r.index);
			case 'closeQuery':
				if (client.sessions.includes(r.session)) {
					client.sessions = client.sessions.filter((id) => id !== r.session);
					open.engine.close(r.session);
				}
				return null;
			case 'complete':
				return open.engine.complete(r.prefix);
			case 'history': {
				const h = await history(open);
				return h ? h.list(Date.now()) : [];
			}
			case 'remember': {
				const h = await history(open);
				await h?.add(r.query, Date.now());
				return null;
			}
			case 'forget': {
				const h = await history(open);
				h?.clear();
				return null;
			}
			case 'pause':
				open.scheduler.pause(r.paused ? HEAVY : []);
				return null;
			case 'retryFailed': {
				const o = open;
				o.writer.atomic(() => {
					o.store.retryFailed();
					o.store.retryLocked();
				});
				o.scheduler.wake();
				return null;
			}
			case 'status':
				return status();
			case 'ping':
				return null;
			case 'bye':
				drop(port);
				return null;
		}
	}

	function connect(port: MessagePort): void {
		const client: Client = { sessions: [], running: new Map() };
		clients.set(port, client);
		port.onmessage = async (e: MessageEvent<ClientRequest & { id: number }>) => {
			const { id } = e.data;
			let reply: Reply;
			try {
				reply = { id, ok: true, value: await answer(port, client, e.data) };
			} catch (error) {
				reply = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
			}
			if (clients.has(port)) port.postMessage(reply);
		};
	}

	async function control(r: ControlRequest): Promise<unknown> {
		switch (r.op) {
			case 'init':
				return init(r);
			case 'memory':
				return memory(r.bridge, r.mode, r.paused);
			case 'connect':
				if (!open) {
					r.port.close();
					return false;
				}
				connect(r.port);
				return true;
			case 'activity':
				if (open) {
					if (r.conditions.visible && r.conditions.idle && !r.conditions.constrained && open.scheduler.blocked) open.scheduler.wake();
					open.scheduler.setConditions(r.conditions);
				}
				return null;
			case 'job':
				return open?.scheduler.tell(r.name, r.message) ?? false;
			case 'close':
				await close(r.wipe);
				return null;
		}
	}

	scope.onmessage = async (e: MessageEvent<ControlRequest & { id: number }>) => {
		const { id } = e.data;
		let reply: Reply;
		try {
			reply = { id, ok: true, value: await control(e.data) };
		} catch (error) {
			reply = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
		}
		scope.postMessage(reply);
	};
}
