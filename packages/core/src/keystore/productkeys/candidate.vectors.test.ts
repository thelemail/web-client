// @vitest-environment node
import { describe, expect, it } from 'vitest';
import raw from '../../interop/vectors/product-candidate-v1.json?raw';
import { candidateBundlesHash, candidateHash, encodeCandidate, parseCandidate } from './candidate';
import { utf8 } from './canonical';
import { b64decode, b64encode, sha256 } from './encoding';
import { ProductKeysError } from './errors';
import type { BundleRef } from './manifests';
import { openRootCandidate, openRootDescriptor, sealRootCandidate } from './secretBundle';

const DIGEST = '0a966c1878dcc14c84b53cb172bec6d98488b8f0e31e56feddd4bce6ad8e4823';

interface RecordVector {
	name: string;
	record: string;
	hash?: string;
	error?: string;
}

interface RootVector {
	name: string;
	key: string;
	header: { accountId: string; amkEpoch: number; bundleId: string; revision: number };
	envelope: string;
	product?: 'app' | 'calendar';
	productKeyEpoch?: number;
	productRoot?: string;
	bundlesHash?: string;
	error?: string;
}

interface WireRef {
	bundleId: string;
	revision: number;
	ciphertextHash: string;
	byteLength: number;
	profileId: string;
}

const file = JSON.parse(raw) as { version: number; bundles: WireRef[]; bundlesHash: string; records: RecordVector[]; roots: RootVector[] };

const refs: BundleRef[] = file.bundles.map((b) => ({ ...b, ciphertextHash: b64decode(b.ciphertextHash) }));

async function code(run: () => unknown): Promise<string | null> {
	try {
		await run();
		return null;
	} catch (err) {
		if (err instanceof ProductKeysError) return err.code;
		throw err;
	}
}

describe('product candidate vectors', () => {
	it('reads the same file as the platform', async () => {
		const hex = Array.from(await sha256(utf8(raw)), (b) => b.toString(16).padStart(2, '0')).join('');
		expect(hex).toBe(DIGEST);
	});

	it('hashes the bundle list like the platform', async () => {
		expect(b64encode(await candidateBundlesHash(refs))).toBe(file.bundlesHash);
	});

	it('parses, hashes and re-encodes candidate records', async () => {
		for (const v of file.records) {
			const bytes = utf8(v.record);
			const got = await code(() => parseCandidate(bytes));
			expect(got, v.name).toBe(v.error ?? null);
			if (v.error) continue;
			expect(b64encode(await candidateHash(bytes)), v.name).toBe(v.hash);
			expect(new TextDecoder().decode(encodeCandidate(parseCandidate(bytes))), v.name).toBe(v.record);
		}
	});

	it('opens root candidates and never as committed descriptors', async () => {
		for (const v of file.roots) {
			const key = b64decode(v.key);
			const envelope = utf8(v.envelope);
			let opened: Awaited<ReturnType<typeof openRootCandidate>> | null = null;
			const got = await code(async () => {
				opened = await openRootCandidate(key, envelope, v.header);
			});
			expect(got, v.name).toBe(v.error ?? null);
			if (v.error || !opened) continue;
			const c = opened as Awaited<ReturnType<typeof openRootCandidate>>;
			expect(c.product).toBe(v.product);
			expect(c.productKeyEpoch).toBe(v.productKeyEpoch);
			expect(b64encode(c.productRoot)).toBe(v.productRoot);
			expect(b64encode(c.bundlesHash)).toBe(v.bundlesHash);
			expect(await code(() => openRootDescriptor(key, envelope, v.header)), v.name).toBe('context');
			const resealed = await sealRootCandidate(key, v.header, c);
			const back = await openRootCandidate(key, resealed, v.header);
			expect(b64encode(back.productRoot)).toBe(v.productRoot);
		}
	});
});
