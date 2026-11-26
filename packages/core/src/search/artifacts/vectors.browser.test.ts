import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';
import type { OpenSearchRootResponse, SearchArtifactRef, SearchSessionRequest } from '$core/keystore/protocol';
import { ProductKeysError } from '$core/keystore/productkeys/errors';
import { openArtifact, sealArtifact } from '$core/keystore/searchkeys/artifact';
import { parseQuery } from '../query';
import type { QueryContext } from '../sqlite/compile';
import { SNAPSHOT } from '../sqlite/harness';
import { Coverage, Dimension } from '../sqlite/types';
import { SearchClient, type ClientDeps, type ClientState } from '../runtime/client';
import { directoryFor } from '../runtime/protocol';
import { memoryPrefs, memoryRecords } from '../runtime/records';
import { FakeSource, localParser, type FakeMessage } from '../sync/fake';

const CTX: QueryContext = { identities: ['ada@calloway.test'], folders: [], labels: [], attachmentText: true };
const SLOW_MS = 300_000;
const WAIT_MS = 240_000;
const ACCOUNT = crypto.randomUUID();
const MESSAGES = 12;

const clients: SearchClient[] = [];
const accounts: string[] = [];

interface Browser {
	ops: string[];
	models: Worker[];
	client: SearchClient;
}

async function browser(server: FakeSource, vault: Map<string, Uint8Array>): Promise<Browser> {
	const accountId = crypto.randomUUID();
	accounts.push(accountId);
	const dbKey = crypto.getRandomValues(new Uint8Array(32));
	const ops: string[] = [];
	const models: Worker[] = [];
	const enc = new TextEncoder();
	const dec = new TextDecoder();
	let held: number | null = null;
	let fences = 0;
	const prefs = memoryPrefs();
	await prefs.put({ accountId, consent: 'saved', paused: false, history: false, semantic: true });
	const deps: ClientDeps = {
		spawn: () => new Worker(new URL('../runtime/search.worker.ts', import.meta.url), { type: 'module' }),
		spawnModel: () => {
			const worker = new Worker(new URL('../model/model.worker.ts', import.meta.url), { type: 'module' });
			models.push(worker);
			return worker;
		},
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
			port.onmessage = async (e: MessageEvent<SearchSessionRequest & { args: never }>) => {
				const { id, cmd, args } = e.data;
				let value: unknown;
				try {
					if (cmd === 'deriveSearchDbKey') value = { ok: true, key: dbKey.slice() };
					else if (cmd === 'sealSearchArtifact') value = { ok: true, artifact: await sealArtifact(root, ctx(args), (args as { payload: Uint8Array }).payload) };
					else if (cmd === 'openSearchArtifact') value = { ok: true, payload: await openArtifact(root, ctx(args), (args as { artifact: Uint8Array }).artifact) };
					else if (cmd === 'claimModelLease') {
						held ??= ++fences;
						value = { ok: true, fence: held };
					} else if (cmd === 'renewModelLease') value = { ok: true, live: (args as { fence: number }).fence === held };
					else if (cmd === 'releaseModelLease') {
						if ((args as { fence: number }).fence === held) held = null;
						value = { ok: true, live: false };
					} else return;
				} catch (error) {
					if (!(error instanceof ProductKeysError)) throw error;
					value = { ok: false, code: error.code === 'too-large' ? 'too_large' : 'invalid' };
				}
				port.postMessage({ type: 'response', id, value });
			};
			return { ok: true, generationId, unlockEpoch: 1, productKeyEpoch: 1, ...(bundle ? {} : { bundle: enc.encode(generationId) }) };
		},
		records: memoryRecords(),
		prefs,
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
	return { ops, models, client };
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

function semantic(state: ClientState, coverage: Coverage): number {
	return (state.status?.sync?.coverage ?? []).filter((c) => c.dimension === Dimension.semantic && c.state === coverage).reduce((n, c) => n + c.count, 0);
}

function cloudVectors(server: FakeSource): number {
	return [...server.cloud.artifacts.values()].filter((a) => a.key.kind === 'vectors').length;
}

async function started(b: Browser, ctx: TestContext): Promise<void> {
	b.client.start();
	const state = await until(b.client, (s) => s.phase === 'ready' && s.status?.cloud !== null && s.status?.cloud !== undefined);
	if (state.status!.persistence !== 'persistent') ctx.skip();
}

function message(id: string, i: number): FakeMessage {
	const subject = i % 2 ? `Ferry ${i}` : `Invoice ${i}`;
	const body = i % 2 ? `The ferry to the island leaves at nine, ticket ${i}.` : `Invoice ${i} for the office chairs is overdue.`;
	return {
		id,
		preview: { subject, sender: { display: 'Bram', address: 'bram@calloway.test' }, recipients: [{ display: 'Ada', address: 'ada@calloway.test', kind: 'to' }], snippet: subject },
		mime: `From: Bram <bram@calloway.test>\nTo: Ada <ada@calloway.test>\nSubject: ${subject}\nMessage-ID: <${id}@calloway.test>\nContent-Type: text/plain; charset=utf-8\n\n${body}\n`
	};
}

async function meaning(client: SearchClient, input: string): Promise<string[]> {
	const parsed = parseQuery(input, SNAPSHOT);
	if (!parsed.ok) throw new Error(parsed.error.code);
	const reply = await client.meaning(parsed.query, CTX, { group: 'message' });
	if (!reply.ok || !('summary' in reply)) throw new Error(JSON.stringify(reply));
	const page = await client.page(reply.summary.id, 0);
	await client.closeQuery(reply.summary.id);
	return page.ok ? page.groups.map((g) => g.best.sourceId) : [];
}

describe('vectors artifact sync', () => {
	it('uploads one vectors artifact per message and lets a second browser search by meaning without its own model', async (ctx) => {
		const server = new FakeSource();
		const vault = new Map<string, Uint8Array>();
		const ids = Array.from({ length: MESSAGES }, () => crypto.randomUUID());
		ids.forEach((id, i) => server.addMessage(message(id, i)));

		const a = await browser(server, vault);
		await started(a, ctx);
		await a.client.setCloudSync(true);
		await until(a.client, (s) => semantic(s, Coverage.complete) === MESSAGES);
		await vi.waitFor(() => expect(cloudVectors(server)).toBe(MESSAGES), { timeout: WAIT_MS, interval: 200 });
		for (const u of server.cloud.uploads) {
			expect(u.length).toBeGreaterThanOrEqual(4096);
			expect(u.length & (u.length - 1)).toBe(0);
		}
		expect(a.models.length).toBeGreaterThan(0);

		const b = await browser(server, vault);
		await started(b, ctx);
		await until(b.client, (s) => semantic(s, Coverage.complete) === MESSAGES);
		expect(b.models).toHaveLength(0);
		expect(b.ops).toContain('artifactFetch');
		expect(cloudVectors(server)).toBe(MESSAGES);
		expect(server.cloud.uploads.filter((u) => u.status === 'stored')).toHaveLength(MESSAGES * 2);

		const fromA = await meaning(a.client, 'ferry crossing to the island');
		expect(fromA).toHaveLength(MESSAGES);
		expect(new Set(fromA.slice(0, MESSAGES / 2))).toEqual(new Set(ids.filter((_, i) => i % 2)));
	}, SLOW_MS);

	it('embeds a message itself when its vectors artifact was tampered with', async (ctx) => {
		const server = new FakeSource();
		const vault = new Map<string, Uint8Array>();
		const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
		ids.forEach((id, i) => server.addMessage(message(id, i)));
		const a = await browser(server, vault);
		await started(a, ctx);
		await a.client.setCloudSync(true);
		await vi.waitFor(() => expect(cloudVectors(server)).toBe(4), { timeout: WAIT_MS, interval: 200 });
		const slot = server.cloud.artifacts.get(server.cloud.slot({ kind: 'vectors', sourceKind: 'message', sourceId: ids[1] }))!;
		slot.bytes = slot.bytes.slice();
		slot.bytes[slot.bytes.length - 1] ^= 1;

		const b = await browser(server, vault);
		await started(b, ctx);
		await until(b.client, (s) => semantic(s, Coverage.complete) === 4);
		expect(b.models.length).toBeGreaterThan(0);
	}, SLOW_MS);
});
