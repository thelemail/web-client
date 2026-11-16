import { afterEach, describe, expect, it } from 'vitest';
import type { OpenSearchRootResponse } from '$core/keystore/protocol';
import { parseQuery } from '../query';
import type { QueryContext } from '../sqlite/compile';
import { SNAPSHOT } from '../sqlite/harness';
import { Coverage, Dimension } from '../sqlite/types';
import { SearchClient, type ClientDeps, type ClientState } from '../runtime/client';
import { directoryFor, type QueryReply, type SyncStatus } from '../runtime/protocol';
import { memoryRecords } from '../runtime/records';
import { FakeSource, type FakeMessage } from './fake';

const CTX: QueryContext = { identities: ['ada@calloway.test'], folders: [], labels: [], attachmentText: false };
const OPTIONS = { sort: 'newest', group: 'message' } as const;
const WAIT_MS = 60_000;
const SLOW_MS = 120_000;

const clients: SearchClient[] = [];
const accounts: string[] = [];

interface Rig {
	server: FakeSource;
	workers: Worker[];
	client(): SearchClient;
}

function rig(server = new FakeSource()): Rig {
	const accountId = crypto.randomUUID();
	accounts.push(accountId);
	const key = crypto.getRandomValues(new Uint8Array(32));
	const generationId = crypto.randomUUID();
	const records = memoryRecords();
	const self: Rig = {
		server,
		workers: [],
		client() {
			const deps: ClientDeps = {
				spawn: () => {
					const worker = new Worker(new URL('../runtime/search.worker.ts', import.meta.url), { type: 'module' });
					self.workers.push(worker);
					return worker;
				},
				broker: () => new SharedWorker(new URL('../runtime/broker.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-search-broker' }).port,
				openRoot: async ({ bundle }, port): Promise<OpenSearchRootResponse> => {
					port.onmessage = (e) => {
						if (e.data.cmd !== 'deriveSearchDbKey') return;
						port.postMessage({ type: 'response', id: e.data.id, value: { ok: true, key: key.slice() } });
					};
					return bundle ? { ok: true, generationId, unlockEpoch: 1 } : { ok: true, generationId, unlockEpoch: 1, bundle: new Uint8Array([1]) };
				},
				records,
				locks: navigator.locks,
				watch: (report) => {
					report({ visible: true, idle: true, constrained: false });
					return () => {};
				},
				serveBridge: (_accountId, port) => server.serve(port)
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

function until(client: SearchClient, test: (state: ClientState) => boolean, ms = WAIT_MS): Promise<ClientState> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			stop();
			reject(new Error(`timed out in ${JSON.stringify(client.state)}`));
		}, ms);
		const stop = client.subscribe((state) => {
			if (!test(state)) return;
			clearTimeout(timer);
			queueMicrotask(() => stop());
			resolve(state);
		});
	});
}

function settled(sync: SyncStatus | null | undefined): boolean {
	return !!sync && sync.phase === 'live' && sync.queue.undescribed === 0 && !sync.queue.bodies[Coverage.pending];
}

const idle = (state: ClientState) => state.phase === 'ready' && state.status?.working === null && settled(state.status?.sync);

const caughtUp = (server: FakeSource) => {
	const seq = server.seq;
	return (state: ClientState) => idle(state) && (state.status?.sync?.seq ?? -1) >= seq;
};

function bodies(state: ClientState): Partial<Record<Coverage, number>> {
	return state.status!.sync!.queue.bodies;
}

function coverage(state: ClientState, dimension: Dimension, wanted: Coverage): number {
	return state.status!.sync!.coverage.find((c) => c.dimension === dimension && c.state === wanted)?.count ?? 0;
}

async function search(client: SearchClient, input: string): Promise<{ matches: number; incomplete: number; ids: string[] }> {
	const parsed = parseQuery(input, SNAPSHOT);
	if (!parsed.ok) throw new Error(parsed.error.code);
	const reply: QueryReply = await client.query(parsed.query, CTX, OPTIONS);
	if (!reply.ok) throw new Error('query failed');
	const page = await client.page(reply.summary.id, 0);
	await client.closeQuery(reply.summary.id);
	const ids = page.ok ? page.groups.map((g) => g.best.sourceId).sort() : [];
	return { matches: reply.summary.matches, incomplete: reply.summary.incomplete, ids };
}

function sync(client: SearchClient): Promise<boolean> {
	return client.tell('sync', null);
}

function preview(subject: string, from = 'bram@calloway.test'): FakeMessage['preview'] {
	return { subject, sender: { display: 'Bram', address: from }, recipients: [{ display: 'Ada', address: 'ada@calloway.test', kind: 'to' }], snippet: subject };
}

function plain(id: string, subject: string, body: string, extra: Partial<FakeMessage> = {}): FakeMessage {
	return {
		id,
		preview: preview(subject),
		mime: `From: Bram <bram@calloway.test>\nTo: Ada <ada@calloway.test>\nSubject: ${subject}\nMessage-ID: <${id}@calloway.test>\nContent-Type: text/plain; charset=utf-8\n\n${body}\n`,
		...extra
	};
}

function alternative(id: string, subject: string): FakeMessage {
	return {
		id,
		preview: preview(subject),
		mime: `From: Bram <bram@calloway.test>
To: Ada <ada@calloway.test>
Subject: ${subject}
Content-Type: multipart/alternative; boundary="b"

--b
Content-Type: text/plain; charset=utf-8

Quarterly figures inside.
--b
Content-Type: text/html; charset=utf-8

<p>Quarterly figures inside.</p><p>Read the <a href="https://news.calloway.test/q3">harbour report</a></p>
<img src="https://pixel.calloway.test/open.gif"><link rel="stylesheet" href="https://cdn.calloway.test/x.css">
--b--
`
	};
}

function draft(subject: string, body: string) {
	return { v: 2, from: { email: 'ada@calloway.test', name: 'Ada' }, to: [{ address: 'cora@calloway.test' }], cc: [], bcc: [], subject, bodyText: body, bodyHtml: '', attachments: [] };
}

function seed(server: FakeSource, n: number): void {
	for (let i = 0; i < n; i++) server.addMessage(plain(`m${String(i).padStart(3, '0')}`, `Invoice ${i}`, `Ledger entry number ${i} for the lighthouse.`));
}

describe('source sync', () => {
	it('indexes a seeded mailbox to complete or an explicit exception and matches the inventory', async () => {
		const server = new FakeSource();
		seed(server, 60);
		server.addMessage(alternative('alt', 'Quarterly'));
		server.addMessage({ ...plain('keyed', 'Alias mail', 'shared alias secret'), key: 'alias-key' });
		server.addMessage({ ...plain('held', 'Held mail', 'not yet released'), held: true });
		server.addDraft({ id: 'd1', doc: draft('Budget plan', 'Numbers for the regatta') });
		server.addDraft({ id: 'broken', doc: null, raw: '{not json' });
		server.addScheduled('s-internal', null, preview('Scheduled hello', 'ada@calloway.test'));
		server.locked.add('alias-key');
		const r = rig(server);
		const a = r.client();
		a.start();
		const done = await until(a, idle);

		expect(done.status!.sync!.queue.total).toBe(66);
		expect(done.status!.sync!.queue.held).toBe(1);
		expect(done.status!.sources).toBe(65);
		expect(bodies(done)).toEqual({ [Coverage.complete]: 62, [Coverage.locked]: 1, [Coverage.failed]: 1, [Coverage.unsupported]: 1 });
		expect(coverage(done, Dimension.metadata, Coverage.locked)).toBe(1);

		expect((await search(a, 'lighthouse')).matches).toBe(60);
		expect((await search(a, '"harbour report"')).ids).toEqual(['alt']);
		expect((await search(a, 'pixel')).matches).toBe(0);
		expect((await search(a, 'regatta')).ids).toEqual(['d1']);
		expect((await search(a, 'in:drafts')).ids).toEqual(['broken', 'd1']);
		expect((await search(a, 'in:scheduled')).ids).toEqual(['s-internal']);
		expect((await search(a, 'released')).matches).toBe(0);
		const secret = await search(a, 'secret');
		expect(secret.matches).toBe(0);
		expect(secret.incomplete).toBeGreaterThan(0);
		expect((await search(a, 'larger:1')).matches).toBe(62);
		const allowed = new Set(['barrier', 'snapshot', 'changes', 'describe', 'preview', 'body', 'draft', 'attachment']);
		expect(server.ops.filter((op) => !allowed.has(op))).toEqual([]);
		expect(server.ops).toContain('body');
		expect(server.ops).toContain('draft');
	}, SLOW_MS);

	it('ends deletes, moves and draft edits made during indexing in the right state', async () => {
		const server = new FakeSource();
		seed(server, 40);
		server.addDraft({ id: 'd1', doc: draft('Menu', 'pancakes for brunch') });
		server.hold();
		const r = rig(server);
		const a = r.client();
		a.start();
		await until(a, (s) => s.status?.sync?.phase === 'live');
		server.remove('message', 'm005');
		server.move('m006', 'archive');
		server.markRead('m007');
		server.editDraft('d1', draft('Menu', 'waffles for brunch'));
		server.addMessage(plain('late', 'Late arrival', 'tugboat schedule'));
		server.resume();
		await sync(a);
		const done = await until(a, caughtUp(server));

		expect(done.status!.sources).toBe(41);
		expect((await search(a, 'lighthouse')).matches).toBe(39);
		expect((await search(a, '"number 5"')).matches).toBe(0);
		expect((await search(a, 'in:archive')).ids).toEqual(['m006']);
		expect((await search(a, 'is:read')).ids).toEqual(['m007']);
		expect((await search(a, 'waffles')).ids).toEqual(['d1']);
		expect((await search(a, 'pancakes')).matches).toBe(0);
		expect((await search(a, 'tugboat')).ids).toEqual(['late']);
	}, SLOW_MS);

	it('leaves no ghost when a draft is sent or a scheduled send is released', async () => {
		const server = new FakeSource();
		server.addDraft({ id: 'd1', doc: draft('Offer', 'counteroffer attached') });
		server.addScheduled('s1', null, preview('Reminder', 'ada@calloway.test'));
		const r = rig(server);
		const a = r.client();
		a.start();
		await until(a, idle);
		expect((await search(a, 'counteroffer')).ids).toEqual(['d1']);
		server.remove('draft', 'd1');
		server.addMessage({ ...plain('sent1', 'Offer', 'counteroffer attached'), direction: 'sent' });
		server.remove('scheduled', 's1');
		server.addMessage({ ...plain('sent2', 'Reminder', 'reminder body'), direction: 'sent' });
		await sync(a);
		await until(a, caughtUp(server));
		expect((await search(a, 'counteroffer')).ids).toEqual(['sent1']);
		expect((await search(a, 'in:drafts')).matches).toBe(0);
		expect((await search(a, 'in:scheduled')).matches).toBe(0);
		expect((await search(a, 'in:sent')).ids).toEqual(['sent1', 'sent2']);
	}, SLOW_MS);

	it('marks a missing alias key locked and recovers once the key is back', async () => {
		const server = new FakeSource();
		server.addAlias('alias-1');
		server.addMessage({ ...plain('keyed', 'Shared inbox', 'mooring fees due'), key: 'alias-key' });
		server.locked.add('alias-key');
		const r = rig(server);
		const a = r.client();
		a.start();
		const locked = await until(a, idle);
		expect(bodies(locked)[Coverage.locked]).toBe(1);
		expect((await search(a, 'mooring')).matches).toBe(0);
		expect((await search(a, 'in:inbox')).ids).toEqual(['keyed']);

		server.locked.delete('alias-key');
		server.bumpAlias('alias-1');
		await sync(a);
		const recovered = await until(a, (s) => caughtUp(server)(s) && bodies(s)[Coverage.complete] === 1);
		expect(bodies(recovered)[Coverage.locked]).toBeUndefined();
		expect((await search(a, 'mooring')).ids).toEqual(['keyed']);
	}, SLOW_MS);

	it('retries locked sources when told the keys changed', async () => {
		const server = new FakeSource();
		server.addMessage({ ...plain('keyed', 'Shared inbox', 'anchor chain'), key: 'alias-key' });
		server.locked.add('alias-key');
		const r = rig(server);
		const a = r.client();
		a.start();
		await until(a, (s) => idle(s) && bodies(s)[Coverage.locked] === 1);
		server.locked.delete('alias-key');
		expect(await a.tell('describe', { retryLocked: true })).toBe(true);
		await until(a, (s) => idle(s) && bodies(s)[Coverage.complete] === 1);
		expect((await search(a, 'anchor')).ids).toEqual(['keyed']);
	}, SLOW_MS);

	it('reconciles the whole inventory after the change cursor expires', async () => {
		const server = new FakeSource();
		seed(server, 30);
		const r = rig(server);
		const a = r.client();
		a.start();
		await until(a, idle);
		server.remove('message', 'm003');
		server.move('m004', 'trash');
		server.pruneJournal();
		server.addMessage(plain('fresh', 'Fresh', 'buoy inspection'));
		await sync(a);
		const reconciled = await until(a, caughtUp(server));
		expect(reconciled.status!.sources).toBe(30);
		expect((await search(a, '"number 3"')).matches).toBe(0);
		expect((await search(a, 'in:trash')).ids).toEqual(['m004']);
		expect((await search(a, 'buoy')).ids).toEqual(['fresh']);
	}, SLOW_MS);

	it('resumes after the worker is killed mid-backfill without duplicates', async () => {
		const server = new FakeSource();
		seed(server, 600);
		const r = rig(server);
		const a = r.client();
		a.start();
		const first = await until(a, (s) => s.phase === 'ready');
		if (first.status?.persistence !== 'persistent') return;
		await until(a, (s) => (s.status?.sync?.queue.bodies[Coverage.complete] ?? 0) >= 250, SLOW_MS);
		r.workers[0].terminate();
		await a.shutdown();
		const opsBefore = server.ops.filter((op) => op === 'body').length;
		const b = r.client();
		b.start();
		const resumed = await until(b, (s) => s.phase === 'ready');
		expect(resumed.status!.sync!.queue.bodies[Coverage.complete]).toBeGreaterThanOrEqual(250);
		const done = await until(b, idle, SLOW_MS);
		expect(done.status!.sources).toBe(600);
		expect(bodies(done)).toEqual({ [Coverage.complete]: 600 });
		expect(server.ops.filter((op) => op === 'body').length - opsBefore).toBeLessThan(600);
		expect((await search(b, 'lighthouse')).matches).toBe(600);
		expect((await search(b, '"number 42"')).ids).toEqual(['m042']);
	}, SLOW_MS * 2);
});
