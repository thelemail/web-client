export interface AssetEntry {
	id: string;
	path: string;
	size: number;
	sha256: string;
}

function hex(buffer: ArrayBuffer): string {
	return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function load(entry: AssetEntry, fetcher: typeof fetch): Promise<Uint8Array> {
	if (!/^\/pdfjs\/[a-z_]+\/[A-Za-z0-9._-]+$/.test(entry.path)) throw new Error('asset path');
	const res = await fetcher(entry.path, { credentials: 'omit', redirect: 'error', cache: 'no-cache' });
	if (!res.ok) throw new Error('asset fetch');
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (bytes.byteLength !== entry.size) throw new Error('asset size');
	if (hex(await crypto.subtle.digest('SHA-256', bytes)) !== entry.sha256) throw new Error('asset hash');
	return bytes;
}

export async function preload(manifest: readonly AssetEntry[], fetcher: typeof fetch = fetch): Promise<Map<string, Uint8Array>> {
	const out = new Map<string, Uint8Array>();
	const queue = [...manifest];
	const workers = Array.from({ length: 6 }, async () => {
		for (let entry = queue.shift(); entry; entry = queue.shift()) out.set(entry.id, await load(entry, fetcher));
	});
	await Promise.all(workers);
	return out;
}
