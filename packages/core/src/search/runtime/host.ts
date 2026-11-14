/// <reference lib="webworker" />
import type { Database } from '@thelemail/sqlite-wasm';
import type {
	DeriveSearchDbKeyResponse,
	SearchSessionCommand,
	SearchSessionRequest,
	SearchSessionResponse
} from '../../keystore/protocol';
import { deleteSearchDb, loadSqlite, openMemorySearchDb, openSearchDb, pauseSearchPool, pruneSearchDb, wipeSearchPool } from '../sqlite/engine';
import { QueryEngine, yieldTask } from '../sqlite/run';
import { SearchWriter, maintain } from '../sqlite/writer';
import { Batch } from './batch';
import {
	directoryFor,
	fileFor,
	type ClientRequest,
	type ControlRequest,
	type InitResult,
	type Persistence,
	type QueryReply,
	type Reply,
	type SearchStatus,
	type StatusEvent
} from './protocol';
import { admit, requestPersistence } from './quota';
import { Scheduler, type Job } from './scheduler';

const KEY_TIMEOUT_MS = 10_000;
const MAX_SESSIONS_PER_CLIENT = 4;

export interface JobContext {
	readonly db: Database;
	readonly writer: SearchWriter;
	batch(job: string): Batch;
	wake(job?: string): void;
}

export type JobFactory = (ctx: JobContext) => Job;

interface Client {
	sessions: number[];
	running: Map<number, AbortController>;
}

interface Open {
	db: Database;
	writer: SearchWriter;
	engine: QueryEngine;
	scheduler: Scheduler;
	persistence: Persistence;
	directory: string | null;
	file: string | null;
	sources: number;
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

export function serve(scope: DedicatedWorkerGlobalScope, factories: readonly JobFactory[]): void {
	let open: Open | null = null;
	let keystore: MessagePort | null = null;
	const clients = new Map<MessagePort, Client>();
	const inflight = new Set<Promise<unknown>>();

	function status(): SearchStatus {
		const o = open!;
		return {
			persistence: o.persistence,
			limited: o.persistence === 'session' ? 'session' : o.scheduler.blocked ? 'quota' : null,
			sources: o.sources,
			working: o.scheduler.working
		};
	}

	function count(o: Open): void {
		o.sources = Number(o.db.selectValue('SELECT count(*) FROM sources'));
	}

	function publish(): void {
		if (!open) return;
		if (!open.scheduler.working) count(open);
		const event: StatusEvent = { type: 'status', status: status() };
		for (const port of clients.keys()) port.postMessage(event);
	}

	async function attach(db: Database, persistence: Persistence, directory: string | null, file: string | null): Promise<void> {
		const sqlite = await loadSqlite();
		const writer = new SearchWriter(db);
		const engine = new QueryEngine(db, sqlite.capi);
		writer.onDelete((source) => engine.invalidate(source));
		const scheduler = new Scheduler({ yieldTask, onChange: publish });
		open = { db, writer, engine, scheduler, persistence, directory, file, sources: 0 };
		count(open);
		const admission = persistence === 'session' ? async () => ({ ok: true }) as const : admit;
		const ctx: JobContext = {
			db,
			writer,
			batch: (job) => new Batch(writer, job, admission, () => scheduler.wake('maintenance')),
			wake: (job) => scheduler.wake(job)
		};
		for (const factory of factories) scheduler.register(factory(ctx));
	}

	async function init(r: Extract<ControlRequest, { op: 'init' }>): Promise<InitResult> {
		if (open) await close(false);
		keystore = r.keystore;
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
			await attach(result.db, 'persistent', directory, file);
			void requestPersistence();
			await pruneSearchDb(directory, file).catch(() => undefined);
			return { ok: true, status: status(), rebuilt: result.rebuilt };
		}
		if (result.code === 'bad-key') return { ok: false, code: 'failed' };
		return memory();
	}

	async function memory(): Promise<InitResult> {
		if (open) await close(false);
		try {
			await attach(await openMemorySearchDb(), 'session', null, null);
		} catch {
			return { ok: false, code: 'failed' };
		}
		return { ok: true, status: status(), rebuilt: false };
	}

	async function close(wipe: boolean): Promise<void> {
		const o = open;
		open = null;
		for (const [port, client] of clients) {
			for (const c of client.running.values()) c.abort();
			port.close();
		}
		clients.clear();
		if (keystore) {
			keystore.postMessage({ id: crypto.randomUUID(), cmd: 'closeSearchSession' } satisfies SearchSessionRequest);
			keystore.close();
			keystore = null;
		}
		if (!o) return;
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

	async function query(client: Client, r: Extract<ClientRequest, { op: 'query' }>): Promise<QueryReply> {
		const o = open!;
		const controller = new AbortController();
		client.running.set(r.token, controller);
		try {
			const running = o.scheduler.foreground(() => o.engine.run(r.query, r.ctx, { ...r.options, signal: controller.signal }));
			const settled = running.then(
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
				return query(client, r);
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
				return memory();
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
