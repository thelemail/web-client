import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/public', () => ({
	PUBLIC_API_BASE_URL: 'https://api.test',
	PUBLIC_SUBMISSION_BASE_URL: 'https://submit.test'
}));
vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/realtime/device', () => ({ deviceId: () => 'device-1' }));

import { registerAuthRouter, registerTransport } from './client';
import { FrameError, createSearchGeneration, decodeFrames, encodeFrames, fetchSearchArtifacts, uploadSearchArtifacts } from './searchSync';
import type { SearchArtifactKey } from './types';

const ACCOUNT = 'acct-1';
const GEN = '0b8f2f0e-3f0d-4bb4-9f4c-6c1c5c7e9a10';
const SOURCE = 'b7c1f3a2-7a3e-4c51-8f0f-2a7c4f6e1d22';
const transport = vi.fn();

const key: SearchArtifactKey = { kind: 'document', sourceKind: 'message', sourceId: SOURCE, contentRevision: 3, componentEpoch: 1001 };

function framed(manifest: unknown, items: Uint8Array[]): Promise<Uint8Array> {
	return encodeFrames(manifest, items)
		.arrayBuffer()
		.then((b) => new Uint8Array(b));
}

beforeEach(() => {
	transport.mockReset();
	registerTransport(transport);
	registerAuthRouter({
		currentAccountId: () => ACCOUNT,
		getAccessToken: () => 'tok',
		ensureFreshToken: async () => {},
		isSessionLost: () => false,
		onUnauthorized: async () => false
	});
});

describe('frames', () => {
	it('round-trips a manifest and its items', async () => {
		const a = new Uint8Array(4096).fill(1);
		const b = new Uint8Array(8192).fill(2);
		const raw = await framed({ items: [4096, 8192] }, [a, b]);
		expect(new DataView(raw.buffer).getUint32(0)).toBe(raw.byteLength - 4096 - 8192 - 4);
		const out = decodeFrames<{ items: number[] }>(raw, (m) => m.items);
		expect(out.manifest.items).toEqual([4096, 8192]);
		expect(out.items[0]).toEqual(a);
		expect(out.items[1]).toEqual(b);
	});

	it('rejects a stream that ends early', async () => {
		const raw = await framed({ items: [4096] }, [new Uint8Array(4096)]);
		expect(() => decodeFrames<{ items: number[] }>(raw.subarray(0, raw.byteLength - 1), (m) => m.items)).toThrow(FrameError);
		expect(() => decodeFrames<{ items: number[] }>(raw.subarray(0, 3), (m) => m.items)).toThrow(FrameError);
	});

	it('rejects trailing bytes', async () => {
		const raw = await framed({ items: [] }, [new Uint8Array(1)]);
		expect(() => decodeFrames<{ items: number[] }>(raw, (m) => m.items)).toThrow(FrameError);
	});
});

describe('uploadSearchArtifacts', () => {
	it('sends one framed body with the manifest first', async () => {
		transport.mockResolvedValue(Response.json({ results: [{ ...key, extractionRevision: 1, status: 'stored', seq: 7 }] }));
		const bytes = new Uint8Array(4096).fill(9);
		const res = await uploadSearchArtifacts(ACCOUNT, GEN, [{ item: { ...key, extractionRevision: 1, length: 4096, sha256: 'ab'.repeat(32) }, bytes }]);
		expect(res.results[0].status).toBe('stored');
		const [url, init] = transport.mock.calls[0];
		expect(url).toBe('https://api.test/v1/search/artifacts');
		expect(init.method).toBe('PUT');
		expect(init.headers['Content-Type']).toBe('application/octet-stream');
		const sent = new Uint8Array(await (init.body as Blob).arrayBuffer());
		const { manifest, items } = decodeFrames<{ generationId: string; items: { length: number }[] }>(sent, (m) => m.items.map((i) => i.length));
		expect(manifest.generationId).toBe(GEN);
		expect(items[0]).toEqual(bytes);
	});
});

describe('fetchSearchArtifacts', () => {
	it('pairs ready items with their bytes and leaves gone and deferred empty', async () => {
		const bytes = new Uint8Array(4096).fill(5);
		const manifest = {
			items: [
				{ ...key, status: 'ready', extractionRevision: 2, length: 4096, sha256: 'cd'.repeat(32), seq: 3 },
				{ ...key, sourceId: 'c1', status: 'gone' },
				{ ...key, sourceId: 'c2', status: 'deferred' }
			]
		};
		transport.mockResolvedValue(new Response(await framed(manifest, [bytes]), { status: 200 }));
		const out = await fetchSearchArtifacts(ACCOUNT, GEN, [key]);
		expect(out.map((o) => o.item.status)).toEqual(['ready', 'gone', 'deferred']);
		expect(out[0].bytes).toEqual(bytes);
		expect(out[1].bytes).toBeNull();
		const [, init] = transport.mock.calls[0];
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({ generationId: GEN, items: [key] });
	});

	it('throws when the stream is cut short', async () => {
		const raw = await framed({ items: [{ ...key, status: 'ready', length: 4096 }] }, [new Uint8Array(4096)]);
		transport.mockResolvedValue(new Response(raw.subarray(0, raw.byteLength - 10), { status: 200 }));
		await expect(fetchSearchArtifacts(ACCOUNT, GEN, [key])).rejects.toThrow(FrameError);
	});
});

describe('createSearchGeneration', () => {
	it('requires If-None-Match and returns the created generation', async () => {
		const gen = { generationId: GEN, productKeyEpoch: 2, bundle: 'AAAA', createdAt: '2026-11-17T00:00:00Z' };
		transport.mockResolvedValue(Response.json(gen, { status: 201 }));
		expect(await createSearchGeneration(ACCOUNT, { generationId: GEN, productKeyEpoch: 2, bundle: 'AAAA' })).toEqual({ created: gen });
		expect(transport.mock.calls[0][1].headers['If-None-Match']).toBe('*');
	});

	it('returns the current generation on 412', async () => {
		const gen = { generationId: SOURCE, productKeyEpoch: 2, bundle: 'BBBB', createdAt: '2026-11-17T00:00:00Z' };
		transport.mockResolvedValue(Response.json({ error: { code: 'search_generation_exists', message: 'exists', generation: gen } }, { status: 412 }));
		expect(await createSearchGeneration(ACCOUNT, { generationId: GEN, productKeyEpoch: 2, bundle: 'AAAA' })).toEqual({ exists: gen });
	});
});
