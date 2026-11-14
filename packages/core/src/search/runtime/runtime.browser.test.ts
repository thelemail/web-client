import { afterEach, describe, expect, it } from 'vitest';
import type { OpenSearchRootResponse } from '$core/keystore/protocol';
import { parseQuery } from '../query';
import type { QueryContext } from '../sqlite/compile';
import { SNAPSHOT } from '../sqlite/harness';
import { SearchClient, type ClientDeps, type ClientState } from './client';
import { directoryFor, type QueryReply } from './protocol';
import { memoryRecords, type RecordStore } from './records';
import type { SyntheticOrder } from './synthetic.worker';

const CTX: QueryContext = { identities: [], folders: [], labels: [], attachmentText: true };
const OPTIONS = { sort: 'newest', group: 'message' } as const;
const MIB = 1024 * 1024;
const WAIT_MS = 60_000;
const SLOW_MS = 90_000;

interface Rig {
	accountId: string;
	records: RecordStore;
	workers: Worker[];
	locked: boolean;
	opened: number;
	client(overrides?: Partial<ClientDeps>): SearchClient;
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
		records: memoryRecords(),
		workers: [],
		locked: false,
		opened: 0,
		client(overrides = {}) {
			const deps: ClientDeps = {
				spawn: () => {
					const worker = new Worker(new URL('./synthetic.worker.ts', import.meta.url), { type: 'module' });
					self.workers.push(worker);
					return worker;
				},
				broker: () =>
					new SharedWorker(new URL('./broker.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-search-broker' }).port,
				openRoot: async ({ bundle }, port): Promise<OpenSearchRootResponse> => {
					if (self.locked) {
						port.close();
						return { ok: false, code: 'locked' };
					}
					self.opened++;
					port.onmessage = (e) => {
						if (e.data.cmd !== 'deriveSearchDbKey') return;
						port.postMessage({ type: 'response', id: e.data.id, value: { ok: true, key: key.slice() } });
					};
					return bundle ? { ok: true, generationId, unlockEpoch: 1 } : { ok: true, generationId, unlockEpoch: 1, bundle: new Uint8Array([1]) };
				},
				records: self.records,
				locks: navigator.locks,
				watch: (report) => {
					report({ visible: true, idle: true, constrained: false });
					return () => {};
				},
				...overrides
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

const ready = (role: 'owner' | 'follower') => (state: ClientState) => state.phase === 'ready' && state.role === role;
const indexed = (n: number) => (state: ClientState) => state.phase === 'ready' && state.status?.sources === n && state.status.working === null;

async function matches(client: SearchClient, input: string): Promise<number> {
	const parsed = parseQuery(input, SNAPSHOT);
	if (!parsed.ok) throw new Error(parsed.error.code);
	const reply: QueryReply = await client.query(parsed.query, CTX, OPTIONS);
	if (!reply.ok) throw new Error('query failed');
	const page = await client.page(reply.summary.id, 0);
	expect(page.ok).toBe(true);
	await client.closeQuery(reply.summary.id);
	return reply.summary.matches;
}

function order(client: SearchClient, message: SyntheticOrder): Promise<boolean> {
	return client.tell('synthetic', message);
}

describe('search runtime', () => {
	it('gives one owner to two clients and lets both search', async () => {
		const r = rig();
		const a = r.client();
		const b = r.client();
		a.start();
		await until(a, ready('owner'));
		b.start();
		await until(b, ready('follower'));
		expect(r.workers).toHaveLength(1);
		expect(await order(a, { total: 600 })).toBe(true);
		await until(a, indexed(600));
		await until(b, indexed(600));
		expect(await matches(a, 'harbour')).toBe(600);
		expect(await matches(b, 'harbour')).toBe(600);
		expect(await matches(b, 'subject:"Synthetic 17"')).toBe(1);
	}, SLOW_MS);

	it('hands the database to the other client when the owner closes', async () => {
		const r = rig();
		const a = r.client();
		const b = r.client();
		a.start();
		const first = await until(a, ready('owner'));
		b.start();
		await until(b, ready('follower'));
		await order(a, { total: 600 });
		await until(a, indexed(600));
		await a.shutdown();
		const next = await until(b, ready('owner'));
		expect(r.workers).toHaveLength(2);
		if (first.status?.persistence === 'persistent') {
			expect(next.status?.sources).toBe(600);
			expect(await matches(b, 'harbour')).toBe(600);
		} else {
			expect(next.status?.limited).toBe('session');
		}
	}, SLOW_MS);

	it('resumes after the worker is killed in the middle of a backfill', async () => {
		const r = rig();
		const a = r.client();
		a.start();
		const first = await until(a, ready('owner'));
		if (first.status?.persistence !== 'persistent') return;
		await order(a, { total: 5000 });
		await until(a, (s) => (s.status?.sources ?? 0) >= 500);
		r.workers[0].terminate();
		await a.shutdown();
		const b = r.client();
		b.start();
		const resumed = await until(b, ready('owner'));
		expect(resumed.status?.sources).toBeGreaterThanOrEqual(500);
		expect(resumed.status?.sources).toBeLessThan(5000);
		expect(resumed.status!.sources % 250).toBe(0);
		await order(b, { total: 5000 });
		await until(b, indexed(5000));
		expect(await matches(b, 'harbour')).toBe(5000);
	}, SLOW_MS);

	it('keeps the last commit searchable when storage runs out', async () => {
		const r = rig();
		const a = r.client();
		a.start();
		const first = await until(a, ready('owner'));
		if (first.status?.persistence !== 'persistent') return;
		await order(a, { total: 250 });
		await until(a, indexed(250));
		await order(a, { storage: { quota: 1000 * MIB, usage: 950 * MIB }, total: 600 });
		const limited = await until(a, (s) => s.status?.limited === 'quota');
		expect(limited.status?.sources).toBe(250);
		expect(await matches(a, 'harbour')).toBe(250);
		await order(a, { storage: { quota: 1000 * MIB, usage: 10 * MIB } });
		await until(a, indexed(600));
		expect(a.state.status?.limited).toBeNull();
	}, SLOW_MS);

	it('runs on a session database without locks', async () => {
		const r = rig();
		const a = r.client({ locks: null });
		a.start();
		const state = await until(a, ready('owner'));
		expect(state.status).toMatchObject({ persistence: 'session', limited: 'session' });
		expect(r.opened).toBe(0);
		await order(a, { total: 300 });
		await until(a, indexed(300));
		expect(await matches(a, 'ledger')).toBe(300);
	});

	it('waits while the vault is locked and opens on retry', async () => {
		const r = rig();
		r.locked = true;
		const a = r.client();
		a.start();
		await until(a, (s) => s.phase === 'locked');
		expect(r.workers).toHaveLength(0);
		r.locked = false;
		a.retry();
		await until(a, ready('owner'));
	});

	it('starts a new generation when the stored bundle is refused', async () => {
		const r = rig();
		await r.records.put({
			accountId: r.accountId,
			bundle: new Uint8Array([9]),
			generationId: 'old-generation',
			installationSalt: new Uint8Array(32),
			hasIndex: true
		});
		let refused = 0;
		const key = crypto.getRandomValues(new Uint8Array(32));
		const a = r.client({
			openRoot: async ({ bundle }, port) => {
				if (bundle) {
					refused++;
					port.close();
					return { ok: false, code: 'stale_epoch' };
				}
				port.onmessage = (e) => port.postMessage({ type: 'response', id: e.data.id, value: { ok: true, key: key.slice() } });
				return { ok: true, generationId: 'new-generation', unlockEpoch: 2, bundle: new Uint8Array([2]) };
			}
		});
		a.start();
		const state = await until(a, ready('owner'));
		expect(refused).toBe(1);
		const record = await r.records.get(r.accountId);
		expect(record?.generationId).toBe('new-generation');
		expect(record?.hasIndex).toBe(state.status?.persistence === 'persistent');
		expect(state.status?.sources).toBe(0);
	});

	it('closes the database, ends the worker and drops a query in flight on shutdown', async () => {
		const r = rig();
		const a = r.client();
		a.start();
		await until(a, ready('owner'));
		await order(a, { total: 3000 });
		await until(a, indexed(3000));
		const parsed = parseQuery('harbour OR ledger', SNAPSHOT);
		if (!parsed.ok) throw new Error('parse');
		const settled = a.query(parsed.query, CTX, OPTIONS).then(
			(reply) => (reply.ok ? 'delivered' : 'cancelled'),
			() => 'dropped'
		);
		await a.shutdown({ wipe: true });
		expect(await settled).not.toBe('delivered');
		expect(a.state.phase).toBe('closed');
		await expect(a.query(parsed.query, CTX, OPTIONS)).rejects.toThrow('unavailable');
		expect(await r.records.get(r.accountId)).toBeNull();
		const root = await navigator.storage.getDirectory().catch(() => null);
		if (root) await expect(root.getDirectoryHandle(directoryFor(r.accountId))).rejects.toThrow();
	}, SLOW_MS);

	it('pauses background work while the page is busy and answers queries meanwhile', async () => {
		const r = rig();
		let report: Parameters<ClientDeps['watch']>[0] = () => {};
		const a = r.client({
			watch: (fn) => {
				report = fn;
				fn({ visible: true, idle: false, constrained: false });
				return () => {};
			}
		});
		a.start();
		await until(a, ready('owner'));
		await order(a, { total: 500 });
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(await matches(a, 'harbour')).toBe(0);
		report({ visible: true, idle: true, constrained: false });
		await until(a, indexed(500));
		expect(await matches(a, 'harbour')).toBe(500);
	});

	it('keeps the page free of long tasks during a 10k backfill', async () => {
		if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return;
		const r = rig();
		const a = r.client();
		a.start();
		await until(a, ready('owner'));
		const long: number[] = [];
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) if (entry.name === 'self') long.push(entry.duration);
		});
		observer.observe({ entryTypes: ['longtask'] });
		await order(a, { total: 10_000 });
		await until(a, indexed(10_000));
		expect(await matches(a, 'harbour')).toBe(10_000);
		observer.disconnect();
		expect(long).toEqual([]);
	}, 180_000);
});
