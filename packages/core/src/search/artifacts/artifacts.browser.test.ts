import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import type { OpenSearchRootResponse, SearchArtifactRef } from '$core/keystore/protocol';
import { ProductKeysError } from '$core/keystore/productkeys/errors';
import { openArtifact, sealArtifact } from '$core/keystore/searchkeys/artifact';
import { parseQuery } from '../query';
import type { QueryContext } from '../sqlite/compile';
import { SNAPSHOT } from '../sqlite/harness';
import { Coverage } from '../sqlite/types';
import { SearchClient, type ClientDeps, type ClientState } from '../runtime/client';
import { directoryFor, type QueryReply } from '../runtime/protocol';
import { memoryPrefs, memoryRecords } from '../runtime/records';
import { docxFiles, pdf, zip } from '../extract/files/fixtures';
import { FakeSource, localParser, type FakeFile, type FakeMessage } from '../sync/fake';

const FULL: QueryContext = { identities: ['ada@calloway.test'], folders: [], labels: [], attachmentText: true };
const OPTIONS = { sort: 'newest', group: 'message' } as const;
const SLOW_MS = 180_000;
const WAIT_MS = 120_000;
const ACCOUNT = crypto.randomUUID();

const clients: SearchClient[] = [];
const accounts: string[] = [];

interface Browser {
	ops: string[];
	client: SearchClient;
}

function browser(server: FakeSource, vault: Map<string, Uint8Array>): Browser {
	const accountId = crypto.randomUUID();
	accounts.push(accountId);
	const dbKey = crypto.getRandomValues(new Uint8Array(32));
	const ops: string[] = [];
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	const deps: ClientDeps = {
		spawn: () => new Worker(new URL('../runtime/search.worker.ts', import.meta.url), { type: 'module' }),
		broker: () => new SharedWorker(new URL('../runtime/broker.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-search-broker' }).port,
		openRoot: async ({ bundle }, port): Promise<OpenSearchRootResponse> => {
			const generationId = bundle ? dec.decode(bundle) : crypto.randomUUID();
			if (!bundle) vault.set(generationId, crypto.getRandomValues(new Uint8Array(32)));
			const root = vault.get(generationId);
			if (!root) {
				port.close();
				return { ok: false, code: 'invalid' };
			}
			const ctx = (a: SearchArtifactRef) => ({ ...a, kind: a.kind, accountId: ACCOUNT, generationId });
			port.onmessage = async (e) => {
				const { id, cmd, args } = e.data;
				let value: unknown;
				try {
					if (cmd === 'deriveSearchDbKey') value = { ok: true, key: dbKey.slice() };
					else if (cmd === 'sealSearchArtifact') value = { ok: true, artifact: await sealArtifact(root, ctx(args), args.payload) };
					else if (cmd === 'openSearchArtifact') value = { ok: true, payload: await openArtifact(root, ctx(args), args.artifact) };
					else return;
				} catch (error) {
					if (!(error instanceof ProductKeysError)) throw error;
					value = { ok: false, code: error.code === 'too-large' ? 'too_large' : 'invalid' };
				}
				port.postMessage({ type: 'response', id, value });
			};
			return { ok: true, generationId, unlockEpoch: 1, productKeyEpoch: 1, ...(bundle ? {} : { bundle: enc.encode(generationId) }) };
		},
		records: memoryRecords(),
		prefs: memoryPrefs(),
		locks: navigator.locks,
		watch: (report) => {
			report({ visible: true, idle: true, constrained: false });
			return () => {};
		},
		serveBridge: (_accountId, port, hooks) => server.serve(port, ops, hooks),
		parser: () => localParser(),
		cloud: {
			state: async () => server.cloud.state(),
			create: async (_a, body) => server.cloud.create(body),
			enable: async () => server.cloud.enable(),
			disable: async () => server.cloud.disable()
		}
	};
	const client = new SearchClient(accountId, deps);
	clients.push(client);
	return { ops, client };
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
			reject(new Error(`timed out in ${JSON.stringify(client.state.status)}`));
		}, ms);
		const stop = client.subscribe((state) => {
			if (!test(state)) return;
			clearTimeout(timer);
			queueMicrotask(() => stop());
			resolve(state);
		});
	});
}

function synced(server: FakeSource) {
	const seq = server.seq;
	return (state: ClientState) => {
		const s = state.status;
		const sync = s?.sync;
		const a = s?.artifacts;
		return (
			state.phase === 'ready' &&
			s?.working === null &&
			s.cloud === 'on' &&
			!!sync &&
			sync.phase === 'live' &&
			(sync.seq ?? -1) >= seq &&
			sync.queue.undescribed === 0 &&
			!sync.queue.bodies[Coverage.pending] &&
			!sync.queue.attachments[Coverage.pending] &&
			!!a &&
			a.state === 'ready' &&
			a.due === 0 &&
			a.listed === 0
		);
	};
}

async function started(b: Browser, ctx: TestContext): Promise<void> {
	b.client.start();
	const state = await until(b.client, (s) => s.phase === 'ready' && s.status?.cloud !== null && s.status?.cloud !== undefined);
	if (state.status!.persistence !== 'persistent') {
		expect(state.status!.cloud).toBe('unavailable');
		ctx.skip();
	}
}

async function search(client: SearchClient, input: string): Promise<string[]> {
	const parsed = parseQuery(input, SNAPSHOT);
	if (!parsed.ok) throw new Error(parsed.error.code);
	const reply: QueryReply = await client.query(parsed.query, FULL, OPTIONS);
	if (!reply.ok) throw new Error('query failed');
	const page = await client.page(reply.summary.id, 0);
	await client.closeQuery(reply.summary.id);
	return page.ok ? page.groups.map((g) => g.best.sourceId).sort() : [];
}

const text = (s: string) => new TextEncoder().encode(s);

function message(id: string, subject: string, body: string, files?: FakeFile[]): FakeMessage {
	return {
		id,
		preview: { subject, sender: { display: 'Bram', address: 'bram@calloway.test' }, recipients: [{ display: 'Ada', address: 'ada@calloway.test', kind: 'to' }], snippet: subject },
		mime: `From: Bram <bram@calloway.test>\nTo: Ada <ada@calloway.test>\nSubject: ${subject}\nMessage-ID: <${id}@calloway.test>\nContent-Type: text/plain; charset=utf-8\n\n${body}\n`,
		...(files ? { files } : {})
	};
}

async function mailbox(server: FakeSource, n: number): Promise<{ ids: string[]; bundle: string }> {
	const ids: string[] = [];
	for (let i = 0; i < n; i++) {
		const id = crypto.randomUUID();
		ids.push(id);
		server.addMessage(message(id, `Invoice ${i}`, `Ledger entry ${i} for the lighthouse.`));
	}
	const bundle = crypto.randomUUID();
	server.addMessage(
		message(bundle, 'Harbour pack', 'Five files attached.', [
			{ id: 'f1', filename: 'ledger.txt', mime: 'text/plain', bytes: text('Mooring ledger for October') },
			{ id: 'f2', filename: 'terms.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: await zip(docxFiles(['Buoy terms apply'])) },
			{ id: 'f3', filename: 'scan.pdf', mime: 'application/pdf', bytes: pdf(['Signed by Ada']) },
			{ id: 'f4', filename: 'notes.csv', mime: 'text/csv', bytes: text('tide,42') },
			{ id: 'f5', filename: 'photo.jpg', mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) }
		])
	);
	return { ids, bundle };
}

const BODY_OPS = new Set(['body', 'attachmentBytes', 'draft', 'draftAttachment']);

describe('search artifact sync', () => {
	it('uploads one padded document per message and lets a second browser skip every body', async (ctx) => {
		const server = new FakeSource();
		const vault = new Map<string, Uint8Array>();
		const { ids, bundle } = await mailbox(server, 30);
		const a = browser(server, vault);
		await started(a, ctx);
		expect(a.client.state.status!.cloud).toBe('off');
		await a.client.setCloudSync(true);
		const first = await until(a.client, synced(server));

		const stored = server.cloud.uploads.filter((u) => u.status === 'stored');
		expect(stored).toHaveLength(31);
		for (const u of server.cloud.uploads) {
			expect(u.length).toBeGreaterThanOrEqual(4096);
			expect(u.length & (u.length - 1)).toBe(0);
		}
		expect(stored.filter((u) => u.sourceId === bundle)).toHaveLength(1);
		expect(server.cloud.artifacts.size).toBe(31);

		const b = browser(server, vault);
		b.client.start();
		const second = await until(b.client, synced(server));
		expect(b.ops.filter((op) => BODY_OPS.has(op))).toEqual([]);
		expect(b.ops).toContain('artifactFetch');
		expect(second.status!.sources).toBe(first.status!.sources);
		expect(second.status!.artifacts!.hydrated).toBe(31);
		expect(second.status!.sync!.queue.bodies).toEqual(first.status!.sync!.queue.bodies);
		expect(second.status!.sync!.queue.attachments).toEqual(first.status!.sync!.queue.attachments);

		for (const q of ['lighthouse', 'attachment:mooring', 'attachment:buoy', 'attachment:tide', '"Signed by Ada"', 'filename:photo']) {
			expect(await search(b.client, q)).toEqual(await search(a.client, q));
		}
		expect(await search(b.client, 'lighthouse')).toEqual([...ids].sort());

		const before = b.ops.length;
		await search(b.client, 'lighthouse');
		await search(b.client, 'attachment:buoy');
		expect(b.ops.length).toBe(before);
		expect(server.cloud.uploads.filter((u) => u.status !== 'stored')).toEqual([]);
	}, SLOW_MS);

	it('rejects a tampered or swapped artifact and extracts that message from mail', async (ctx) => {
		const server = new FakeSource();
		const vault = new Map<string, Uint8Array>();
		const { ids } = await mailbox(server, 6);
		const a = browser(server, vault);
		await started(a, ctx);
		expect(a.client.state.status!.cloud).toBe('off');
		await a.client.setCloudSync(true);
		await until(a.client, synced(server));
		server.cloud.tamper(ids[0]);
		server.cloud.swap(ids[1], ids[2]);

		const b = browser(server, vault);
		b.client.start();
		const done = await until(b.client, synced(server));
		expect(b.ops.filter((op) => op === 'body')).toHaveLength(3);
		expect(done.status!.artifacts!.rejected).toBe(3);
		expect(done.status!.artifacts!.hydrated).toBe(4);
		expect(await search(b.client, 'lighthouse')).toEqual([...ids].sort());
		expect(await search(b.client, 'entry')).toEqual([...ids].sort());
		expect(server.cloud.uploads.filter((u) => u.status === 'stored' && ids.slice(0, 3).includes(u.sourceId))).toHaveLength(6);

		const c = browser(server, vault);
		c.client.start();
		await until(c.client, synced(server));
		expect(c.ops.filter((op) => BODY_OPS.has(op))).toEqual([]);
	}, SLOW_MS);

	it('indexes concurrently in two browsers without duplicates or errors', async (ctx) => {
		const server = new FakeSource();
		const vault = new Map<string, Uint8Array>();
		server.cloud.enable();
		await mailbox(server, 20);
		const a = browser(server, vault);
		const b = browser(server, vault);
		await Promise.all([started(a, ctx), started(b, ctx)]);
		const [da, db] = await Promise.all([until(a.client, synced(server)), until(b.client, synced(server))]);
		expect(server.cloud.generation).not.toBeNull();
		expect(da.status!.sources).toBe(db.status!.sources);
		expect(da.status!.sync!.queue.bodies).toEqual(db.status!.sync!.queue.bodies);
		expect(server.cloud.artifacts.size).toBe(21);
		expect(new Set(server.cloud.uploads.map((u) => u.status))).not.toContain('inaccessible');
		expect(await search(b.client, 'lighthouse')).toEqual(await search(a.client, 'lighthouse'));
	}, SLOW_MS);

	it('removes a message deleted elsewhere and keeps the local index when sync is turned off', async (ctx) => {
		const server = new FakeSource();
		const vault = new Map<string, Uint8Array>();
		server.cloud.enable();
		const { ids } = await mailbox(server, 5);
		const a = browser(server, vault);
		await started(a, ctx);
		await until(a.client, synced(server));
		const b = browser(server, vault);
		b.client.start();
		await until(b.client, synced(server));

		server.remove('message', ids[0]);
		expect([...server.cloud.artifacts.values()].some((x) => x.key.sourceId === ids[0])).toBe(false);
		await b.client.tell('sync', null);
		await until(b.client, synced(server));
		expect(await search(b.client, 'lighthouse')).toEqual(ids.slice(1).sort());

		await b.client.setCloudSync(false);
		const off = await until(b.client, (s) => s.status?.cloud === 'off');
		expect(off.status!.artifacts).toBeNull();
		expect(server.cloud.artifacts.size).toBe(0);
		expect(await search(b.client, 'lighthouse')).toEqual(ids.slice(1).sort());

		await b.client.setCloudSync(true);
		await until(b.client, synced(server));
		expect(server.cloud.artifacts.size).toBe(5);
		expect(server.cloud.used.size).toBe(2);
	}, SLOW_MS);
});
