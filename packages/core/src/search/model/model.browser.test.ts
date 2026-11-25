import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { Field } from '../sqlite/types';
import { FIXTURES } from './fixtures';
import reference from './fixtures.reference.json';
import type { EmbeddedPassage, EmbedInput, ModelCall, ModelMessage } from './protocol';
import { ASSET_CACHE } from './assets';

declare module 'vitest/browser' {
	interface BrowserCommands {
		watchNetwork: () => Promise<null>;
		networkSeen: () => Promise<string[]>;
	}
}

const MODEL_ASSET = /^\/_app\/immutable\/models\/[0-9a-f]{64}\.(?:onnx|json|wasm)$/;
const SECRET_WORDS = ['Lisbon', 'Lissabon', 'Лиссабон', 'reembolso', 'Rechnung', 'quarterly', 'budget'];

let worker: Worker;
let port: MessagePort;
let next = 0;
let loadRequests: string[] = [];
const progress: number[] = [];

function call<T>(request: ModelCall): Promise<T> {
	const id = next++;
	return new Promise((resolve, reject) => {
		const listener = (e: MessageEvent<ModelMessage>) => {
			const m = e.data;
			if (m.type === 'progress') {
				progress.push(m.loaded);
				return;
			}
			if (m.id !== id) return;
			port.removeEventListener('message', listener);
			if (m.ok) resolve(m.value as T);
			else reject(new Error(m.reason));
		};
		port.addEventListener('message', listener);
		port.postMessage({ ...request, id });
	});
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i] * b[i];
	return s;
}

function body(text: string): EmbedInput {
	return { subject: null, parts: [{ ordinal: 0, field: Field.body, text, attachmentId: null, place: null }] };
}

beforeAll(async () => {
	await caches.delete(ASSET_CACHE);
	await commands.watchNetwork();
	worker = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-model' });
	const channel = new MessageChannel();
	worker.postMessage({ op: 'init', port: channel.port2 }, [channel.port2]);
	port = channel.port1;
	port.start();
	await call({ op: 'load' });
	loadRequests = await commands.networkSeen();
}, 300_000);

afterAll(() => worker?.terminate());

describe('model worker', () => {
	it('loads only pinned first-party assets', () => {
		const models = loadRequests.map((u) => new URL(u)).filter((u) => u.pathname.startsWith('/_app/immutable/models/'));
		expect(models).toHaveLength(4);
		expect(models.map((u) => u.pathname).every((p) => MODEL_ASSET.test(p))).toBe(true);
		expect(models.every((u) => u.origin === location.origin && u.search === '')).toBe(true);
		expect(loadRequests.every((u) => new URL(u).origin === location.origin)).toBe(true);
		expect(progress.length).toBeGreaterThan(0);
	});

	it('matches the reference vectors within a tight bound', async () => {
		for (const [name, input] of Object.entries(FIXTURES)) {
			const want = reference[name as keyof typeof reference];
			const got = await call<EmbeddedPassage[]>({ op: 'embed', input });
			expect(got.length, name).toBe(want.count);
			for (const [index, vector] of Object.entries(want.picks)) {
				const v = got[Number(index)].vector;
				expect(v.every(Number.isFinite), name).toBe(true);
				expect(Math.sqrt(dot(v, v)), name).toBeCloseTo(1, 5);
				expect(dot(v, vector), `${name} ${index}`).toBeGreaterThan(0.9999);
				expect(Math.max(...Array.from(v, (x, i) => Math.abs(x - vector[i]))), `${name} ${index}`).toBeLessThan(1e-3);
			}
		}
	}, 120_000);

	it('covers the start, middle and end of a long body without going over the token limit', async () => {
		const input = FIXTURES.long;
		const text = input.parts[0].text;
		const got = await call<EmbeddedPassage[]>({ op: 'embed', input });
		const spans = got.flatMap((p) => p.refs);
		expect(Math.min(...spans.map((r) => r.start))).toBe(0);
		expect(Math.max(...spans.map((r) => r.end))).toBe(text.length);
		expect(spans.some((r) => r.start < text.length / 2 && r.end > text.length / 2)).toBe(true);
	});

	it('makes no requests while embedding', async () => {
		await commands.watchNetwork();
		for (const input of Object.values(FIXTURES)) await call({ op: 'embed', input });
		await call({ op: 'query', text: 'refund for the Lisbon flight' });
		const seen = await commands.networkSeen();
		expect(seen).toEqual([]);
		expect(loadRequests.some((u) => SECRET_WORDS.some((w) => decodeURIComponent(u).includes(w)))).toBe(false);
	});

	it('places related passages across languages closer than unrelated ones', async () => {
		const [en] = await call<EmbeddedPassage[]>({ op: 'embed', input: body('The flight was cancelled and I want my money back.') });
		const [pt] = await call<EmbeddedPassage[]>({ op: 'embed', input: body('O voo foi cancelado e quero o meu dinheiro de volta.') });
		const [ru] = await call<EmbeddedPassage[]>({ op: 'embed', input: body('Рецепт пирога с яблоками и корицей.') });
		expect(dot(en.vector, pt.vector)).toBeGreaterThan(dot(en.vector, ru.vector));
	});

	it('answers a query while a long batch is running', async () => {
		const order: string[] = [];
		const batch = call<EmbeddedPassage[]>({ op: 'embed', input: FIXTURES.long }).then((p) => {
			order.push('batch');
			return p;
		});
		const query = call<Float32Array>({ op: 'query', text: 'hiring plans' }).then((v) => {
			order.push('query');
			return v;
		});
		const [passages, vector] = await Promise.all([batch, query]);
		expect(order[0]).toBe('query');
		expect(passages.length).toBeGreaterThan(2);
		expect(Math.sqrt(dot(vector, vector))).toBeCloseTo(1, 5);
	}, 120_000);

	it('refuses a query longer than the model accepts', async () => {
		await expect(call({ op: 'query', text: Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ') })).rejects.toThrow('tooLong');
	});

	it('stops a batch when it is cancelled', async () => {
		const id = next;
		const pending = call({ op: 'embed', input: FIXTURES.long });
		port.postMessage({ op: 'cancel', id });
		await expect(pending).rejects.toThrow('cancelled');
	});
});
