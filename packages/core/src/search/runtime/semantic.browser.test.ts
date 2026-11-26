import { afterEach, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import type { SearchSessionRequest } from '$core/keystore/protocol';
import { parseQuery } from '../query';
import type { QueryContext } from '../sqlite/compile';
import { SNAPSHOT } from '../sqlite/harness';
import { Coverage, Dimension } from '../sqlite/types';
import { SearchClient, type ClientDeps, type ClientState } from './client';
import { directoryFor } from './protocol';
import { memoryPrefs, memoryRecords } from './records';

declare module 'vitest/browser' {
	interface BrowserCommands {
		watchNetwork: () => Promise<null>;
		networkSeen: () => Promise<string[]>;
	}
}

const WAIT_MS = 120_000;
const CTX: QueryContext = { identities: [], folders: [], labels: [], attachmentText: true };

interface Rig {
	accountId: string;
	live: boolean;
	claims: number;
	held: number | null;
	searchWorkers: Worker[];
	models: Worker[];
	terminated: Worker[];
	client(semantic: boolean): Promise<SearchClient>;
}

const clients: SearchClient[] = [];
const accounts: string[] = [];

function rig(): Rig {
	const accountId = crypto.randomUUID();
	accounts.push(accountId);
	const key = crypto.getRandomValues(new Uint8Array(32));
	const generationId = crypto.randomUUID();
	const self: Rig = {
		accountId,
		live: true,
		claims: 0,
		held: null,
		searchWorkers: [],
		models: [],
		terminated: [],
		async client(semantic) {
			const prefs = memoryPrefs();
			await prefs.put({ accountId, consent: 'saved', paused: false, history: false, semantic });
			const track = (worker: Worker, into: Worker[]) => {
				into.push(worker);
				const terminate = worker.terminate.bind(worker);
				worker.terminate = () => {
					self.terminated.push(worker);
					terminate();
				};
				return worker;
			};
			const deps: ClientDeps = {
				spawn: () => track(new Worker(new URL('./semantic.worker.ts', import.meta.url), { type: 'module' }), self.searchWorkers),
				spawnModel: () => track(new Worker(new URL('../model/model.worker.ts', import.meta.url), { type: 'module' }), self.models),
				broker: () => new SharedWorker(new URL('./broker.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-search-broker' }).port,
				openRoot: async ({ bundle }, port) => {
					port.onmessage = (e: MessageEvent<SearchSessionRequest>) => {
						const { id, cmd, args } = e.data;
						if (!self.live) return;
						const reply = (value: unknown) => port.postMessage({ type: 'response', id, value });
						if (cmd === 'deriveSearchDbKey') reply({ ok: true, key: key.slice() });
						else if (cmd === 'claimModelLease') {
							if (self.held === null) self.held = ++self.claims;
							reply({ ok: true, fence: self.held });
						} else if (cmd === 'renewModelLease') reply({ ok: true, live: self.live && (args as { fence: number }).fence === self.held });
						else if (cmd === 'releaseModelLease') {
							if ((args as { fence: number }).fence === self.held) self.held = null;
							reply({ ok: true, live: false });
						}
					};
					return { ok: true, generationId, unlockEpoch: 1, productKeyEpoch: 1, ...(bundle ? {} : { bundle: new Uint8Array([1]) }) };
				},
				records: memoryRecords(),
				prefs,
				locks: navigator.locks,
				watch: (report) => {
					report({ visible: true, idle: true, constrained: false });
					return () => {};
				},
				serveBridge: () => () => {}
			};
			const client = new SearchClient(accountId, deps);
			clients.push(client);
			return client;
		}
	};
	return self;
}

afterEach(async () => {
	for (const client of clients.splice(0)) await client.shutdown();
	const root = await navigator.storage.getDirectory().catch(() => null);
	for (const id of accounts.splice(0)) await root?.removeEntry(directoryFor(id), { recursive: true }).catch(() => {});
});

function until(client: SearchClient, test: (state: ClientState) => boolean): Promise<ClientState> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			stop();
			reject(new Error(`timed out in ${JSON.stringify(client.state)}`));
		}, WAIT_MS);
		const stop = client.subscribe((state) => {
			if (!test(state)) return;
			clearTimeout(timer);
			queueMicrotask(() => stop());
			resolve(state);
		});
	});
}

function semantic(state: ClientState, coverage: Coverage): number {
	return (state.status?.sync?.coverage ?? []).filter((c) => c.dimension === Dimension.semantic && c.state === coverage).reduce((n, c) => n + c.count, 0);
}

describe('search by meaning in the search runtime', () => {
	it('embeds every message through one model owned by the owner tab', async () => {
		const r = rig();
		const a = await r.client(true);
		const b = await r.client(true);
		a.start();
		await until(a, (s) => s.phase === 'ready' && s.role === 'owner');
		b.start();
		await until(b, (s) => s.phase === 'ready' && s.role === 'follower');
		expect(await a.tell('mail', { total: 30 })).toBe(true);
		const done = await until(a, (s) => semantic(s, Coverage.complete) === 30);
		expect(done.status?.semantic?.state).toBe('ready');
		expect(r.models).toHaveLength(1);
		expect(r.searchWorkers).toHaveLength(1);
		expect(r.claims).toBe(1);
	}, WAIT_MS);

	it('throws away results once the lease is gone, as after a lock, and stops the model', async () => {
		const r = rig();
		const a = await r.client(true);
		a.start();
		await until(a, (s) => s.phase === 'ready');
		await a.tell('mail', { total: 400 });
		await until(a, (s) => semantic(s, Coverage.complete) > 0);
		r.live = false;
		const atLock = semantic(a.state, Coverage.complete);
		await until(a, () => r.terminated.includes(r.models[0]));
		const after = semantic(a.state, Coverage.complete);
		await new Promise((resolve) => setTimeout(resolve, 1500));
		expect(semantic(a.state, Coverage.complete)).toBe(after);
		expect(after).toBeLessThanOrEqual(atLock + 1);
		expect(r.models).toHaveLength(1);
	}, WAIT_MS);

	it('answers a meaning query from local vectors without a network request', async () => {
		const r = rig();
		const a = await r.client(true);
		a.start();
		await until(a, (s) => s.phase === 'ready');
		await a.tell('mail', { total: 30 });
		await until(a, (s) => semantic(s, Coverage.complete) === 30 && s.status?.working === null);
		const parsed = parseQuery('ferry crossing to the island', SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		await commands.watchNetwork();
		const reply = await a.meaning(parsed.query, CTX, { group: 'message' });
		const seen = await commands.networkSeen();
		expect(seen).toEqual([]);
		if (!reply.ok || !('summary' in reply)) throw new Error(JSON.stringify(reply));
		expect(reply.summary).toMatchObject({ groups: 30, eligible: 30, incomplete: 0, rebuilding: false });
		const page = await a.page(reply.summary.id, 0);
		if (!page.ok) throw new Error(page.reason);
		const top = page.groups.slice(0, 10).map((g) => Number(g.best.sourceId.slice(1)));
		expect(top.every((id) => id % 2 === 1)).toBe(true);
		expect(page.groups[0].passage?.text).toContain('ferry');
	}, WAIT_MS);

	it('loads no model and keeps no passages while search by meaning is off', async () => {
		const r = rig();
		const a = await r.client(false);
		a.start();
		await until(a, (s) => s.phase === 'ready');
		await a.tell('mail', { total: 20 });
		await until(a, (s) => s.status?.sources === 20 && s.status.working === null);
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(r.models).toHaveLength(0);
		expect(a.state.status?.semantic).toBeNull();
		expect(semantic(a.state, Coverage.complete) + semantic(a.state, Coverage.pending)).toBe(0);
		const parsed = parseQuery('ferry island', SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		expect(await a.meaning(parsed.query, CTX, { group: 'message' })).toEqual({ ok: false, unavailable: 'off' });
	}, WAIT_MS);
});
