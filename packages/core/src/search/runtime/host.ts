/// <reference lib="webworker" />
import type { Database } from '@thelemail/sqlite-wasm';
import type { DeriveSearchDbKeyResponse, OpenSearchArtifactResponse, SealSearchArtifactResponse, SearchSessionRequest } from '../../keystore/protocol';
import { deleteSearchDb, loadSqlite, openMemorySearchDb, openSearchDb, pauseSearchPool, pruneSearchDb, wipeSearchPool } from '../sqlite/engine';
import { SearchHistory, historyKey } from '../sqlite/history';
import { QueryEngine, yieldTask } from '../sqlite/run';
import { SearchWriter, maintain } from '../sqlite/writer';
import { Batch } from './batch';
import { Bridge, type BridgeCaller } from '../sync/bridge';
import { ParserClient, type ExtractorPort } from '../sync/extractor';
import type { SyncProgress } from '../sync/jobs';
import { SyncStore } from '../sync/store';
import { ArtifactStore } from '../artifacts/store';
import { attachGeneration, type SyncSession } from '../artifacts/jobs';
import { MODEL_ID } from '../model/job';
import { ModelLink } from '../model/link';
import { PassageStore } from '../model/store';
import { meaningSplit } from '../query/classify';
import { VectorCache } from '../vectors/cache';
import {
	directoryFor,
	fileFor,
	type ClientRequest,
	type ControlRequest,
	type InitResult,
	type MeaningReply,
	type Mode,
	type Persistence,
	type ProgressEvent,
	type QueryReply,
	type Reply,
	type SearchStatus,
	type StatusEvent,
	type CloudState,
	type ModelEvent,
	type ResyncEvent,
	type SyncAttach,
	type SyncStatus
} from './protocol';
import { admit, requestPersistence, type Admission } from './quota';
import { Scheduler, type Job, type JobClass } from './scheduler';
import { sessionCall } from './session';

const MAX_SESSIONS_PER_CLIENT = 4;
const HEAVY: readonly JobClass[] = ['body', 'attachments', 'embeddings', 'artifacts'];

export interface JobContext {
	readonly db: Database;
	readonly writer: SearchWriter;
	readonly store: SyncStore;
	readonly artifacts: ArtifactStore;
	readonly bridge: BridgeCaller | null;
	readonly extractor: ExtractorPort;
	readonly progress: SyncProgress;
	readonly model: ModelLink | null;
	readonly passages: PassageStore | null;
	admit(bytes: number): Promise<Admission>;
	sync(): SyncSession | null;
	syncSettled(): boolean;
	batch(job: string): Batch;
	wake(job?: string): void;
	later(job: string, ms: number): void;
	now(): number;
}

export interface ServeOptions {
	extractor?: (parser: MessagePort | null) => ExtractorPort;
}

function defaultExtractor(parser: MessagePort | null): ExtractorPort {
	return new ParserClient(parser);
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
	artifacts: ArtifactStore;
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
	model: ModelLink | null;
	passages: PassageStore;
	vectors: VectorCache;
}

type SyncSlot = { state: 'off' } | { state: 'pending' } | { state: 'on'; session: SyncSession; port: MessagePort };

function syncSession(a: SyncAttach): SyncSession {
	const port = a.keystore;
	return {
		generationId: a.generationId,
		limits: a.limits,
		listed: false,
		full: false,
		async seal(ref, payload) {
			const r = await sessionCall<SealSearchArtifactResponse>(port, 'sealSearchArtifact', { ...ref, payload });
			if (r?.ok) return r;
			return { ok: false, code: r?.code === 'too_large' ? 'too_large' : 'unavailable' };
		},
		async open(ref, artifact) {
			const r = await sessionCall<OpenSearchArtifactResponse>(port, 'openSearchArtifact', { ...ref, artifact });
			if (r?.ok) return r;
			return { ok: false, code: r?.code === 'invalid' || r?.code === 'too_large' ? 'invalid' : 'unavailable' };
		}
	};
}

function endSync(slot: SyncSlot): void {
	if (slot.state !== 'on') return;
	slot.port.postMessage({ id: crypto.randomUUID(), cmd: 'closeSearchSession' } satisfies SearchSessionRequest);
	slot.port.close();
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
	let sync: SyncSlot = { state: 'off' };
	let cloud: CloudState | null = null;
	let spawning: ((port: MessagePort | null) => void) | null = null;
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
			sync: o.sync,
			artifacts: artifactStatus(o),
			cloud,
			semantic: o.model?.state ?? null
		};
	}

	function artifactStatus(o: Open): SearchStatus['artifacts'] {
		if (sync.state === 'off') return null;
		const counts = o.artifacts.counts();
		if (sync.state === 'pending') return { ...counts, state: 'pending', full: false };
		return { ...counts, state: sync.session.listed ? 'ready' : 'listing', full: sync.session.full };
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
		parser: MessagePort | undefined,
		paused: boolean,
		semantic: boolean
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
			artifacts: new ArtifactStore(db),
			bridge,
			extractor: (options.extractor ?? defaultExtractor)(parser ?? null),
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
			sync: null,
			model: null,
			passages: new PassageStore(db, writer),
			vectors: new VectorCache(db, writer)
		};
		open = o;
		if (semantic && mode === 'saved') o.model = new ModelLink(modelHost(o));
		else o.passages.clear();
		writer.onInsert(() => {
			if (o.progress.phase === 'live') engine.generation++;
		});
		count(o);
		const admission = persistence === 'session' ? async (): Promise<Admission> => ({ ok: true }) : admit;
		const ctx: JobContext = {
			db,
			writer,
			store: o.store,
			artifacts: o.artifacts,
			bridge,
			extractor: o.extractor,
			progress: o.progress,
			model: o.model,
			passages: o.passages,
			admit: admission,
			sync: () => (open === o && sync.state === 'on' ? sync.session : null),
			syncSettled: () => sync.state === 'off' || (sync.state === 'on' && sync.session.listed),
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

	function modelHost(o: Open): ConstructorParameters<typeof ModelLink>[0] {
		return {
			keystore: () => (open === o ? keystore : null),
			spawn: () =>
				new Promise((resolve) => {
					spawning?.(null);
					spawning = resolve;
					scope.postMessage({ type: 'model', op: 'spawn' } satisfies ModelEvent);
				}),
			stop: () => scope.postMessage({ type: 'model', op: 'stop' } satisfies ModelEvent),
			changed: publish
		};
	}

	function model(port: MessagePort | null): void {
		const waiting = spawning;
		spawning = null;
		if (waiting) {
			waiting(open?.model ? port : null);
			if (!open?.model) port?.close();
			return;
		}
		if (port) port.close();
		else open?.model?.crashed();
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
			sync = r.syncPending ? { state: 'pending' } : { state: 'off' };
			await attach(result.db, 'persistent', 'saved', directory, file, r.bridge, r.parser, r.paused, r.semantic);
			void requestPersistence();
			await pruneSearchDb(directory, file).catch(() => undefined);
			return { ok: true, status: status(), rebuilt: result.rebuilt };
		}
		if (result.code === 'bad-key') return { ok: false, code: 'failed' };
		return memory(r.bridge, r.parser, 'saved', r.paused, r.semantic, true);
	}

	async function memory(
		bridge: MessagePort | undefined,
		parser: MessagePort | undefined,
		mode: Mode,
		paused: boolean,
		semantic: boolean,
		keepKeystore = false
	): Promise<InitResult> {
		if (open) await close(false, keepKeystore);
		try {
			await attach(await openMemorySearchDb(), 'session', mode, null, null, bridge, parser, paused, semantic);
		} catch {
			return { ok: false, code: 'failed' };
		}
		return { ok: true, status: status(), rebuilt: false };
	}

	async function close(wipe: boolean, keepKeystore = false): Promise<void> {
		const o = open;
		open = null;
		o?.model?.close();
		spawning?.(null);
		spawning = null;
		endSync(sync);
		sync = { state: 'off' };
		cloud = null;
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
		o.vectors.dispose();
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

	function attachSync(next: SyncAttach | null): boolean {
		const o = open;
		endSync(sync);
		if (!o || o.persistence !== 'persistent') {
			next?.keystore.close();
			sync = { state: 'off' };
			if (o) o.writer.atomic(() => o.artifacts.clearIndex());
			return false;
		}
		if (!next) {
			sync = { state: 'off' };
			o.writer.atomic(() => o.artifacts.clearIndex());
		} else {
			attachGeneration(o.writer, () => o.artifacts.reset(), next.generationId);
			sync = { state: 'on', session: syncSession(next), port: next.keystore };
		}
		o.scheduler.wake();
		publish();
		return true;
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

	async function meaning(client: Client, r: Extract<ClientRequest, { op: 'meaning' }>): Promise<MeaningReply> {
		const o = open!;
		const model = o.model;
		if (!model) return { ok: false, unavailable: 'off' };
		const split = meaningSplit(r.query.root);
		if (!split) return { ok: false, unavailable: 'words' };
		const exclude = r.options.exclude;
		if (exclude !== null && !client.sessions.includes(exclude)) return { ok: false, unavailable: 'stale' };
		const controller = new AbortController();
		const signal = controller.signal;
		client.running.set(r.token, controller);
		try {
			const running = o.scheduler.foreground(async (): Promise<MeaningReply> => {
				const epoch = o.passages.scanEpoch(MODEL_ID);
				if (!epoch) return { ok: false, unavailable: 'empty' };
				const queried = await model.query(split.text, signal);
				signal.throwIfAborted();
				if (open !== o) throw new Error('closed');
				if (!queried.ok) return { ok: false, unavailable: queried.reason === 'tooLong' ? 'tooLong' : queried.reason === 'busy' ? 'busy' : 'model' };
				const outcome = await o.engine.meaning(r.query, r.ctx, { group: r.options.group, vector: queried.vector, epoch, cache: o.vectors, exclude: exclude ?? undefined, signal });
				if (!outcome.ok) return 'reason' in outcome ? { ok: false, unavailable: outcome.reason } : outcome;
				return outcome;
			});
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
			if (signal.aborted) return { ok: false, cancelled: true };
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
			case 'meaning':
				return meaning(client, r);
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
				o.scheduler.tell('embeddings', 'retry');
				o.scheduler.wake();
				return null;
			}
			case 'resync':
				scope.postMessage({ type: 'resync' } satisfies ResyncEvent);
				return null;
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
				return memory(r.bridge, r.parser, r.mode, r.paused, r.semantic);
			case 'model':
				model(r.port);
				return null;
			case 'connect':
				if (!open) {
					r.port.close();
					return false;
				}
				connect(r.port);
				return true;
			case 'sync':
				cloud = r.cloud;
				return attachSync(r.sync);
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
