import { describe, expect, it } from 'vitest';
import type { ArtifactContext } from './artifact';
import { openArtifact, sealArtifact } from './artifact';
import { searchDbKey } from './dbKey';
import { openSearchRoot, sealSearchRoot } from './rootBundle';

const ACCOUNT = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function received<T>(port: MessagePort): Promise<T> {
	return new Promise((resolve) => {
		port.onmessage = (ev) => resolve(ev.data as T);
	});
}

describe('search keys in a browser', () => {
	it('wraps a search root, seals artifacts and hands buffers across a port', async () => {
		const productRoot = crypto.getRandomValues(new Uint8Array(32));
		const { searchRoot, bundle } = await sealSearchRoot(productRoot, ACCOUNT, 1, []);
		const opened = await openSearchRoot(productRoot, bundle, ACCOUNT, 1, []);
		expect(opened.generationId).toBe(searchRoot.generationId);
		expect(opened.root).toEqual(searchRoot.root);

		const context: ArtifactContext = {
			accountId: ACCOUNT,
			generationId: opened.generationId,
			kind: 'vectors',
			sourceKind: 'message',
			sourceId: '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f',
			contentRevision: 1,
			componentEpoch: 1,
			extractionRevision: 1
		};
		const payload = crypto.getRandomValues(new Uint8Array(5120));
		const artifact = await sealArtifact(opened.root, context, payload);
		expect(artifact.length).toBe(8192);

		const channel = new MessageChannel();
		const arrives = received<{ artifact: Uint8Array; key: Uint8Array }>(channel.port2);
		const key = await searchDbKey(opened.root, ACCOUNT, opened.generationId, crypto.getRandomValues(new Uint8Array(32)));
		channel.port1.postMessage({ artifact, key }, [artifact.buffer as ArrayBuffer, key.buffer as ArrayBuffer]);
		const got = await arrives;
		expect(artifact.byteLength).toBe(0);
		expect(key.byteLength).toBe(0);
		expect(got.key.length).toBe(32);
		expect(await openArtifact(opened.root, context, got.artifact)).toEqual(payload);
		await expect(openArtifact(opened.root, { ...context, kind: 'document' }, got.artifact)).rejects.toThrow();
		channel.port1.close();
	});
});
