export interface AssetEntry {
	id: string;
	offset: number;
	size: number;
	sha256: string;
}

export interface AssetBundle {
	path: string;
	size: number;
	sha256: string;
	entries: readonly AssetEntry[];
}

const BUNDLE_PATH = /^\/_app\/immutable\/assets\/pdfjs-[0-9a-f]{16}\.bin$/;
const ID = /^[a-z_]+\/[A-Za-z0-9._-]+$/;

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function preload(bundle: AssetBundle, fetcher: typeof fetch = fetch): Promise<Map<string, Uint8Array>> {
	if (!BUNDLE_PATH.test(bundle.path)) throw new Error('asset path');
	const res = await fetcher(bundle.path, { credentials: 'omit', redirect: 'error' });
	if (!res.ok) throw new Error('asset fetch');
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (bytes.byteLength !== bundle.size) throw new Error('asset size');
	if ((await sha256(bytes)) !== bundle.sha256) throw new Error('asset hash');
	const out = new Map<string, Uint8Array>();
	for (const entry of bundle.entries) {
		if (!ID.test(entry.id) || out.has(entry.id)) throw new Error('asset id');
		if (!Number.isSafeInteger(entry.offset) || !Number.isSafeInteger(entry.size) || entry.offset < 0 || entry.size < 0 || entry.offset + entry.size > bytes.byteLength) {
			throw new Error('asset range');
		}
		const part = bytes.slice(entry.offset, entry.offset + entry.size);
		if ((await sha256(part)) !== entry.sha256) throw new Error('asset hash');
		out.set(entry.id, part);
	}
	return out;
}
