// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ProductKeysError } from '../productkeys/errors';
import type { ArtifactContext } from './artifact';
import { ARTIFACT_OVERHEAD, openArtifact, sealArtifact } from './artifact';

const root = new Uint8Array(32).fill(5);
const context: ArtifactContext = {
	accountId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
	generationId: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
	kind: 'document',
	sourceKind: 'message',
	sourceId: '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f',
	contentRevision: 4,
	componentEpoch: 1,
	extractionRevision: 2
};

function payload(n: number): Uint8Array {
	const out = new Uint8Array(n);
	for (let i = 0; i < n; i++) out[i] = (i * 31 + 7) & 0xff;
	return out;
}

async function refused(run: () => Promise<unknown>): Promise<string> {
	try {
		await run();
	} catch (err) {
		if (err instanceof ProductKeysError) return err.code;
		throw err;
	}
	return 'opened';
}

describe('search artifact envelope', () => {
	it.each([
		[1, 4096],
		[4096 - ARTIFACT_OVERHEAD, 4096],
		[4096 - ARTIFACT_OVERHEAD + 1, 8192],
		[4096, 8192],
		[5120, 8192],
		[70_000, 131_072]
	])('seals %i bytes of payload into a %i byte object', async (n, size) => {
		const sealed = await sealArtifact(root, context, payload(n));
		expect(sealed.length).toBe(size);
		expect(await openArtifact(root, context, sealed)).toEqual(payload(n));
	});

	it('never repeats salt, nonce or ciphertext for the same input', async () => {
		const a = await sealArtifact(root, context, payload(64));
		const b = await sealArtifact(root, context, payload(64));
		expect(a.subarray(4, 48)).not.toEqual(b.subarray(4, 48));
		expect(a.subarray(48)).not.toEqual(b.subarray(48));
	});

	it.each([
		['account', { accountId: '9a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' }],
		['generation', { generationId: '9b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e' }],
		['kind', { kind: 'vectors' }],
		['source kind', { sourceKind: 'draft' }],
		['source', { sourceId: '9c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f' }],
		['content revision', { contentRevision: 5 }],
		['component epoch', { componentEpoch: 2 }],
		['extraction revision', { extractionRevision: 3 }]
	] as [string, Partial<ArtifactContext>][])('does not open under another %s', async (_name, change) => {
		const sealed = await sealArtifact(root, context, payload(200));
		expect(await refused(() => openArtifact(root, { ...context, ...change }, sealed))).toBe('decrypt');
	});

	it('does not open under another search root', async () => {
		const sealed = await sealArtifact(root, context, payload(200));
		expect(await refused(() => openArtifact(new Uint8Array(32).fill(6), context, sealed))).toBe('decrypt');
	});

	it('refuses any object that is not a whole bucket', async () => {
		const sealed = await sealArtifact(root, context, payload(200));
		expect(await refused(() => openArtifact(root, context, sealed.subarray(0, 4095)))).toBe('malformed');
		expect(await refused(() => openArtifact(root, context, sealed.subarray(0, 2048)))).toBe('malformed');
		expect(await refused(() => openArtifact(root, context, new Uint8Array(6000)))).toBe('malformed');
	});
});
