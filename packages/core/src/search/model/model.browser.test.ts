import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Field } from '../sqlite/types';
import type { EmbeddedPassage, EmbedInput, ModelCall, ModelMessage } from './protocol';

let worker: Worker;
let port: MessagePort;
let next = 0;
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

function norm(v: Float32Array): number {
	return Math.sqrt(v.reduce((s, x) => s + x * x, 0));
}

function body(text: string, subject: string | null = null): EmbedInput {
	return { subject, parts: [{ ordinal: 0, field: Field.body, text, attachmentId: null, place: null }] };
}

beforeAll(async () => {
	worker = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module', name: 'thelemail-model' });
	const channel = new MessageChannel();
	worker.postMessage({ op: 'init', port: channel.port2 }, [channel.port2]);
	port = channel.port1;
	port.start();
	await call({ op: 'load' });
}, 300_000);

afterAll(() => worker?.terminate());

describe('model worker', () => {
	it('reports download progress up to the manifest total', () => {
		expect(progress.length).toBeGreaterThan(0);
	});

	it('embeds passages into finite unit vectors', async () => {
		const out = await call<EmbeddedPassage[]>({ op: 'embed', input: body('The flight to Lisbon was cancelled and the refund has not arrived.', 'Refund') });
		expect(out).toHaveLength(1);
		expect(out[0].vector).toHaveLength(384);
		expect(out[0].vector.every(Number.isFinite)).toBe(true);
		expect(norm(out[0].vector)).toBeCloseTo(1, 5);
	});

	it('places related passages across languages closer than unrelated ones', async () => {
		const [en] = await call<EmbeddedPassage[]>({ op: 'embed', input: body('The flight was cancelled and I want my money back.') });
		const [pt] = await call<EmbeddedPassage[]>({ op: 'embed', input: body('O voo foi cancelado e quero o meu dinheiro de volta.') });
		const [ru] = await call<EmbeddedPassage[]>({ op: 'embed', input: body('Рецепт пирога с яблоками и корицей.') });
		const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i], 0);
		expect(dot(en.vector, pt.vector)).toBeGreaterThan(dot(en.vector, ru.vector));
	});

	it('answers a query while a long batch is running', async () => {
		const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} talks about the quarterly budget review.`).join(' ');
		const order: string[] = [];
		const batch = call<EmbeddedPassage[]>({ op: 'embed', input: body(long) }).then((p) => {
			order.push('batch');
			return p;
		});
		const query = call<Float32Array>({ op: 'query', text: 'budget' }).then((v) => {
			order.push('query');
			return v;
		});
		const [passages, vector] = await Promise.all([batch, query]);
		expect(order[0]).toBe('query');
		expect(passages.length).toBeGreaterThan(2);
		expect(norm(vector)).toBeCloseTo(1, 5);
	}, 120_000);
});
