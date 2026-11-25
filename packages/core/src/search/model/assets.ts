export interface ModelAsset {
	url: string;
	size: number;
	sha256: string;
}

export interface ModelManifest {
	name: string;
	hash: string;
	total: number;
	files: Record<'model' | 'tokenizer' | 'tokenizerConfig' | 'runtime', ModelAsset>;
	licenses: string[];
}

export const ASSET_CACHE = 'thelemail-model-assets';
const ASSET_URL = /^\/_app\/immutable\/models\/[0-9a-f]{64}\.(?:onnx|json|wasm)$/;
const DIGEST = /^[0-9a-f]{64}$/;

export type AssetFailure = 'manifest' | 'fetch' | 'size' | 'digest';

export class AssetError extends Error {
	constructor(readonly reason: AssetFailure) {
		super(`model asset ${reason}`);
	}
}

export interface AssetDeps {
	fetch: typeof fetch;
	cache: () => Promise<Cache | null>;
}

export const browserAssetDeps: AssetDeps = {
	fetch: (input, init) => fetch(input, init),
	cache: async () => {
		try {
			return typeof caches === 'undefined' ? null : await caches.open(ASSET_CACHE);
		} catch {
			return null;
		}
	}
};

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function read(res: Response, asset: ModelAsset, progress?: (bytes: number) => void): Promise<Uint8Array<ArrayBuffer>> {
	const out = new Uint8Array(asset.size);
	if (!res.body) throw new AssetError('fetch');
	const reader = res.body.getReader();
	let at = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (at + value.byteLength > asset.size) {
			await reader.cancel().catch(() => undefined);
			throw new AssetError('size');
		}
		out.set(value, at);
		at += value.byteLength;
		progress?.(value.byteLength);
	}
	if (at !== asset.size) throw new AssetError('size');
	return out;
}

export function validAsset(asset: ModelAsset): boolean {
	return ASSET_URL.test(asset.url) && DIGEST.test(asset.sha256) && Number.isSafeInteger(asset.size) && asset.size > 0;
}

export async function loadAsset(asset: ModelAsset, deps: AssetDeps, progress?: (bytes: number) => void): Promise<Uint8Array<ArrayBuffer>> {
	if (!validAsset(asset)) throw new AssetError('manifest');
	const cache = await deps.cache();
	if (cache) {
		const hit = await cache.match(asset.url).catch(() => undefined);
		if (hit) {
			const bytes = await read(hit, asset).catch(() => null);
			if (bytes && (await digest(bytes)) === asset.sha256) {
				progress?.(asset.size);
				return bytes;
			}
			await cache.delete(asset.url).catch(() => false);
		}
	}
	let res: Response;
	try {
		res = await deps.fetch(asset.url, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
	} catch {
		throw new AssetError('fetch');
	}
	if (!res.ok) throw new AssetError('fetch');
	const bytes = await read(res, asset, progress);
	if ((await digest(bytes)) !== asset.sha256) throw new AssetError('digest');
	await cache?.put(asset.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } })).catch(() => undefined);
	return bytes;
}

export async function dropAssets(): Promise<void> {
	if (typeof caches === 'undefined') return;
	await caches.delete(ASSET_CACHE).catch(() => false);
}
