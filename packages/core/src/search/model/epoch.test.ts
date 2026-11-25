import { describe, expect, it } from 'vitest';
import { epochInput, semanticEpoch } from './epoch';

const HASH = 'a'.repeat(64);

describe('semanticEpoch', () => {
	it('is stable for the same inputs', async () => {
		expect(await semanticEpoch(HASH, 1001)).toBe(await semanticEpoch(HASH, 1001));
		expect(Number.isSafeInteger(await semanticEpoch(HASH, 1001))).toBe(true);
	});

	it('changes with the asset manifest and the extraction revision', async () => {
		const base = await semanticEpoch(HASH, 1001);
		expect(await semanticEpoch('b'.repeat(64), 1001)).not.toBe(base);
		expect(await semanticEpoch(HASH, 1002)).not.toBe(base);
	});

	it('binds the recipe and the vector format', () => {
		const input = JSON.parse(epochInput(HASH, 1001));
		expect(input.recipe).toMatchObject({ prefix: 'passage:', context: 48, content: 384, overlap: 48, total: 512 });
		expect(input.vector).toMatchObject({ storage: 'fp16-le', dimensions: 384, pooling: 'attention-mean', normalization: 'l2' });
	});
});
