// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SearchSessionRequest } from '../../keystore/protocol';
import { Field } from '../sqlite/types';
import { ModelLink, type ModelHost, type ModelState } from './link';
import type { ModelMessage, ModelRequest } from './protocol';

type Lease = { claim: () => unknown; renew: (fence: number) => unknown };

interface Rig {
	link: ModelLink;
	keystore: MessagePort;
	commands: SearchSessionRequest[];
	model: { requests: ModelRequest[]; reply(m: ModelMessage): void } | null;
	stops: number;
	states: ModelState['state'][];
	fence(fence: number): void;
	spawned: Promise<void>;
}

const ports: MessagePort[] = [];

function rig(lease: Lease, spawn: 'ok' | 'none' = 'ok'): Rig {
	const keys = new MessageChannel();
	ports.push(keys.port1, keys.port2);
	const commands: SearchSessionRequest[] = [];
	keys.port2.onmessage = (e: MessageEvent<SearchSessionRequest>) => {
		commands.push(e.data);
		const value = e.data.cmd === 'claimModelLease' ? lease.claim() : e.data.cmd === 'renewModelLease' ? lease.renew((e.data.args as { fence: number }).fence) : { ok: true, live: false };
		keys.port2.postMessage({ type: 'response', id: e.data.id, value });
	};
	let markSpawned!: () => void;
	const spawned = new Promise<void>((r) => (markSpawned = r));
	const r: Rig = {
		link: null as unknown as ModelLink,
		keystore: keys.port1,
		commands,
		model: null,
		stops: 0,
		states: [],
		fence: (fence) => keys.port2.postMessage({ type: 'event', event: 'modelFenced', fence }),
		spawned
	};
	const host: ModelHost = {
		keystore: () => keys.port1,
		spawn: async () => {
			if (spawn === 'none') return null;
			const channel = new MessageChannel();
			ports.push(channel.port1, channel.port2);
			const requests: ModelRequest[] = [];
			channel.port2.onmessage = (e: MessageEvent<ModelRequest>) => requests.push(e.data);
			r.model = { requests, reply: (m) => channel.port2.postMessage(m) };
			markSpawned();
			return channel.port1;
		},
		stop: () => {
			r.stops++;
		},
		changed: () => r.states.push(r.link.state.state)
	};
	r.link = new ModelLink(host);
	return r;
}

async function until(check: () => boolean): Promise<void> {
	await vi.waitFor(() => {
		if (!check()) throw new Error('not yet');
	});
}

async function ready(r: Rig): Promise<void> {
	const acquired = r.link.acquire();
	await r.spawned;
	await until(() => r.model!.requests.length > 0);
	r.model!.reply({ type: 'progress', loaded: 10, total: 20 });
	r.model!.reply({ type: 'reply', id: r.model!.requests[0].id, ok: true, value: null });
	expect(await acquired).toEqual({ ok: true });
}

const input = { subject: null, parts: [{ ordinal: 1, field: Field.body, text: 'Hello.', attachmentId: null, place: null }] };

afterEach(() => {
	for (const p of ports.splice(0)) p.close();
});

describe('ModelLink', () => {
	it('claims the lease, starts the model and reports download progress', async () => {
		const r = rig({ claim: () => ({ ok: true, fence: 3 }), renew: () => ({ ok: true, live: true }) });
		await ready(r);
		expect(r.link.fence).toBe(3);
		expect(r.states).toEqual(['loading', 'downloading', 'ready']);
		expect(r.commands.map((c) => c.cmd)).toEqual(['claimModelLease']);
	});

	it('waits without starting a model while another account holds the lease', async () => {
		const r = rig({ claim: () => ({ ok: false, code: 'busy', retryMs: 1234 }), renew: () => ({ ok: true, live: false }) });
		expect(await r.link.acquire()).toEqual({ ok: false, retryMs: 1234 });
		expect(r.link.state).toEqual({ state: 'waiting' });
		expect(r.model).toBeNull();
	});

	it('reports a missing owner rendezvous instead of loading a model', async () => {
		const r = rig({ claim: () => ({ ok: true, fence: 1 }), renew: () => ({ ok: true, live: true }) }, 'none');
		expect(await r.link.acquire()).toEqual({ ok: false, unavailable: 'owner' });
		expect(r.link.state).toEqual({ state: 'unavailable', reason: 'owner' });
	});

	it('drops an inference in flight when the lease is fenced', async () => {
		const r = rig({ claim: () => ({ ok: true, fence: 5 }), renew: () => ({ ok: true, live: false }) });
		await ready(r);
		const pending = r.link.embed(input);
		await until(() => r.model!.requests.some((q) => q.op === 'embed'));
		r.fence(5);
		expect(await pending).toEqual({ ok: false, reason: 'closed' });
		await until(() => r.commands.some((c) => c.cmd === 'releaseModelLease'));
		expect(r.stops).toBe(1);
		expect(r.link.fence).toBeNull();
	});

	it('ignores a fence event for an older lease', async () => {
		const r = rig({ claim: () => ({ ok: true, fence: 6 }), renew: () => ({ ok: true, live: true }) });
		await ready(r);
		r.fence(2);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(r.link.fence).toBe(6);
		expect(r.stops).toBe(0);
	});

	it('refuses to commit when the keystore no longer confirms the fence', async () => {
		let live = true;
		const r = rig({ claim: () => ({ ok: true, fence: 7 }), renew: () => ({ ok: true, live }) });
		await ready(r);
		expect(await r.link.check(7)).toBe(true);
		live = false;
		expect(await r.link.check(7)).toBe(false);
		expect(r.stops).toBe(1);
		expect(await r.link.check(7)).toBe(false);
	});

	it('treats a crash while loading as a device that cannot hold the model', async () => {
		const r = rig({ claim: () => ({ ok: true, fence: 8 }), renew: () => ({ ok: true, live: true }) });
		const acquired = r.link.acquire();
		await r.spawned;
		await until(() => r.model!.requests.length > 0);
		r.link.crashed();
		expect(await acquired).toEqual({ ok: false, unavailable: 'memory' });
		expect(r.link.state).toEqual({ state: 'unavailable', reason: 'memory' });
	});

	it('cancels an inference when its step is aborted', async () => {
		const r = rig({ claim: () => ({ ok: true, fence: 9 }), renew: () => ({ ok: true, live: true }) });
		await ready(r);
		const controller = new AbortController();
		void r.link.embed(input, controller.signal);
		await until(() => r.model!.requests.some((q) => q.op === 'embed'));
		controller.abort();
		await until(() => r.model!.requests.some((q) => q.op === 'cancel'));
		const embed = r.model!.requests.find((q) => q.op === 'embed')!;
		expect(r.model!.requests.find((q) => q.op === 'cancel')!.id).toBe(embed.id);
	});

	it('loads a cold model for a query from cache only and answers with the vector', async () => {
		const r = rig({ claim: () => ({ ok: true, fence: 10 }), renew: () => ({ ok: true, live: true }) });
		const answer = r.link.query('flight refund');
		await r.spawned;
		await until(() => r.model!.requests.length > 0);
		expect(r.model!.requests[0]).toMatchObject({ op: 'load', offline: true });
		r.model!.reply({ type: 'reply', id: r.model!.requests[0].id, ok: true, value: null });
		await until(() => r.model!.requests.some((q) => q.op === 'query'));
		const q = r.model!.requests.find((x) => x.op === 'query')!;
		expect(q).toMatchObject({ text: 'flight refund' });
		const vector = new Float32Array(384).fill(0.05);
		r.model!.reply({ type: 'reply', id: q.id, ok: true, value: vector });
		expect(await answer).toEqual({ ok: true, vector });
	});

	it('gives up on a query instead of downloading when the model files are not cached', async () => {
		const r = rig({ claim: () => ({ ok: true, fence: 11 }), renew: () => ({ ok: true, live: true }) });
		const answer = r.link.query('flight refund');
		await r.spawned;
		await until(() => r.model!.requests.length > 0);
		r.model!.reply({ type: 'reply', id: r.model!.requests[0].id, ok: false, reason: 'assets' });
		expect(await answer).toEqual({ ok: false, reason: 'unavailable' });
		expect(r.link.state).toEqual({ state: 'idle' });
		expect(r.stops).toBe(1);
	});

	it('discards a query answer that arrives after the lease is fenced', async () => {
		const r = rig({ claim: () => ({ ok: true, fence: 12 }), renew: () => ({ ok: true, live: true }) });
		await ready(r);
		const answer = r.link.query('budget');
		await until(() => r.model!.requests.some((q) => q.op === 'query'));
		r.fence(12);
		expect(await answer).toEqual({ ok: false, reason: 'closed' });
	});

	it('reports a busy model when another account holds the lease', async () => {
		const r = rig({ claim: () => ({ ok: false, code: 'busy', retryMs: 500 }), renew: () => ({ ok: true, live: false }) });
		expect(await r.link.query('budget')).toEqual({ ok: false, reason: 'busy' });
	});
});
