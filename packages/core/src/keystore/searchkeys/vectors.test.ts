// @vitest-environment node
import { describe, expect, it } from 'vitest';
import raw from '../../interop/vectors/search-keys-v1.json?raw';
import { utf8 } from '../productkeys/canonical';
import { b64decode, b64encode, sha256 } from '../productkeys/encoding';
import { ProductKeysError } from '../productkeys/errors';
import type { ArtifactContext } from './artifact';
import { artifactSize, MAX_ARTIFACT_BYTES, MIN_ARTIFACT_BYTES, openArtifact, sealArtifact } from './artifact';
import { searchDbKey } from './dbKey';
import { openSearchRoot, sealSearchRoot } from './rootBundle';

const DIGEST = '9346143ef469ff26161aca1b43703f1e821989c76f2de797d1653ee480d44a70';

interface RootVector {
	name: string;
	productRoot: string;
	forbidden: string[];
	accountId: string;
	productKeyEpoch: number;
	envelope: string;
	generationId?: string;
	bundleId?: string;
	root?: string;
	error?: string;
}

interface ArtifactVector {
	name: string;
	root: string;
	context: ArtifactContext;
	artifact: string;
	payload?: string;
	size?: number;
	error?: string;
}

interface DbKeyVector {
	name: string;
	root: string;
	accountId: string;
	generationId: string;
	salt: string;
	key?: string;
	error?: string;
}

const vectors = JSON.parse(raw) as {
	searchRootBundles: RootVector[];
	artifacts: ArtifactVector[];
	buckets: { payloadLength: number; size: number }[];
	dbKeys: DbKeyVector[];
};

async function expectCode(code: string, run: () => Promise<unknown>): Promise<void> {
	let thrown: unknown;
	try {
		await run();
	} catch (err) {
		thrown = err;
	}
	expect(thrown).toBeInstanceOf(ProductKeysError);
	expect((thrown as ProductKeysError).code).toBe(code);
}

describe('search key vectors', () => {
	it('is the file the trust library generated', async () => {
		const sum = await sha256(utf8(raw));
		expect(Array.from(sum, (b) => b.toString(16).padStart(2, '0')).join('')).toBe(DIGEST);
	});

	describe('search root bundles', () => {
		for (const v of vectors.searchRootBundles) {
			it(v.name, async () => {
				const run = () => openSearchRoot(b64decode(v.productRoot), utf8(v.envelope), v.accountId, v.productKeyEpoch, v.forbidden.map(b64decode));
				if (v.error) return expectCode(v.error, run);
				const got = await run();
				expect(got.generationId).toBe(v.generationId);
				expect(got.bundleId).toBe(v.bundleId);
				expect(b64encode(got.root)).toBe(v.root);
			});
		}

		it('opens what it seals and nothing from another epoch', async () => {
			const productRoot = new Uint8Array(32).fill(7);
			const account = vectors.searchRootBundles[0].accountId;
			const { searchRoot, bundle } = await sealSearchRoot(productRoot, account, 3, []);
			const opened = await openSearchRoot(productRoot, bundle, account, 3, []);
			expect(opened.generationId).toBe(searchRoot.generationId);
			expect(b64encode(opened.root)).toBe(b64encode(searchRoot.root));
			await expectCode('context', () => openSearchRoot(productRoot, bundle, account, 4, []));
		});
	});

	describe('artifacts', () => {
		for (const v of vectors.artifacts) {
			it(v.name, async () => {
				const run = () => openArtifact(b64decode(v.root), v.context, b64decode(v.artifact));
				if (v.error) return expectCode(v.error, run);
				const payload = await run();
				expect(b64encode(payload)).toBe(v.payload ?? '');
				const again = await sealArtifact(b64decode(v.root), v.context, payload);
				expect(again.length).toBe(v.size);
				expect(b64encode(await openArtifact(b64decode(v.root), v.context, again))).toBe(v.payload ?? '');
			});
		}
	});

	it('puts every payload length in the bucket trust does', () => {
		for (const v of vectors.buckets) {
			const size = artifactSize(v.payloadLength);
			expect(size).toBe(v.size);
			expect(size).toBeGreaterThanOrEqual(MIN_ARTIFACT_BYTES);
			expect(size & (size - 1)).toBe(0);
		}
		expect(() => artifactSize(MAX_ARTIFACT_BYTES)).toThrow(ProductKeysError);
	});

	describe('database keys', () => {
		for (const v of vectors.dbKeys) {
			it(v.name, async () => {
				const run = () => searchDbKey(b64decode(v.root), v.accountId, v.generationId, b64decode(v.salt));
				if (v.error) return expectCode(v.error, run);
				expect(b64encode(await run())).toBe(v.key);
			});
		}
	});
});
