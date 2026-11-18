import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { preload, type AssetBundle } from './assets';

const PATH = '/_app/immutable/assets/pdfjs-0123456789abcdef.bin';

function hex(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function fixture() {
	const a = new Uint8Array([1, 2, 3]);
	const b = new Uint8Array([4, 5]);
	const bytes = new Uint8Array([...a, ...b]);
	const bundle: AssetBundle = {
		path: PATH,
		size: bytes.byteLength,
		sha256: hex(bytes),
		entries: [
			{ id: 'cmaps/A.bcmap', offset: 0, size: 3, sha256: hex(a) },
			{ id: 'standard_fonts/B.pfb', offset: 3, size: 2, sha256: hex(b) }
		]
	};
	return { bytes, bundle };
}

function serve(bytes: Uint8Array, status = 200) {
	return vi.fn(async () => new Response(bytes.slice(), { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('parser asset bundle', () => {
	it('fetches the bundle once and splits it into verified assets', async () => {
		const { bytes, bundle } = fixture();
		const fetcher = serve(bytes);
		const assets = await preload(bundle, fetcher);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(fetcher).toHaveBeenCalledWith(PATH, { credentials: 'omit', redirect: 'error' });
		expect([...assets.keys()]).toEqual(['cmaps/A.bcmap', 'standard_fonts/B.pfb']);
		expect([...assets.get('cmaps/A.bcmap')!]).toEqual([1, 2, 3]);
		expect([...assets.get('standard_fonts/B.pfb')!]).toEqual([4, 5]);
	});

	it('refuses a path outside the immutable bundle', async () => {
		const { bytes, bundle } = fixture();
		const fetcher = serve(bytes);
		await expect(preload({ ...bundle, path: '/pdfjs/cmaps/A.bcmap' }, fetcher)).rejects.toThrow('asset path');
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('refuses a failed fetch', async () => {
		const { bytes, bundle } = fixture();
		await expect(preload(bundle, serve(bytes, 404))).rejects.toThrow('asset fetch');
	});

	it('refuses a bundle of the wrong size or hash', async () => {
		const { bytes, bundle } = fixture();
		await expect(preload(bundle, serve(bytes.subarray(1)))).rejects.toThrow('asset size');
		const tampered = bytes.slice();
		tampered[0] ^= 1;
		await expect(preload(bundle, serve(tampered))).rejects.toThrow('asset hash');
	});

	it('refuses an entry whose own hash does not match', async () => {
		const { bytes, bundle } = fixture();
		const entries = [bundle.entries[0], { ...bundle.entries[1], sha256: bundle.entries[0].sha256 }];
		await expect(preload({ ...bundle, entries }, serve(bytes))).rejects.toThrow('asset hash');
	});

	it('refuses entries out of range, duplicated or with an unsafe id', async () => {
		const { bytes, bundle } = fixture();
		const [a, b] = bundle.entries;
		await expect(preload({ ...bundle, entries: [a, { ...b, size: 3 }] }, serve(bytes))).rejects.toThrow('asset range');
		await expect(preload({ ...bundle, entries: [a, { ...b, offset: -1 }] }, serve(bytes))).rejects.toThrow('asset range');
		await expect(preload({ ...bundle, entries: [a, a] }, serve(bytes))).rejects.toThrow('asset id');
		await expect(preload({ ...bundle, entries: [{ ...a, id: '../A.bcmap' }] }, serve(bytes))).rejects.toThrow('asset id');
	});
});
