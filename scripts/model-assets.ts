import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Plugin } from 'vite';

const MANIFEST = 'virtual:model-assets';
const DIR = '_app/immutable/models';
const HUB = 'https://huggingface.co';
const MANIFEST_FILE = join(import.meta.dirname, 'model-manifest.json');
const WORKSPACE = join(import.meta.dirname, '..');

const TYPES: Record<string, string> = {
	'.wasm': 'application/wasm',
	'.json': 'application/json',
	'.txt': 'text/plain; charset=utf-8',
	'.onnx': 'application/octet-stream'
};

interface PinnedFile {
	id: string;
	source: 'huggingface' | 'package';
	path: string;
	size: number;
	sha256: string;
}

interface PinnedLicense {
	covers: string[];
	source: 'repo' | 'package';
	path: string;
	sha256: string;
}

interface Pinned {
	name: string;
	model: { conversion: string; revision: string };
	files: PinnedFile[];
	licenses: PinnedLicense[];
}

export interface ModelAsset {
	url: string;
	size: number;
	sha256: string;
}

export interface ModelAssets {
	name: string;
	hash: string;
	total: number;
	files: Record<string, ModelAsset>;
	licenses: string[];
}

interface Located {
	url: string;
	fileName: string;
	size: number;
	sha256: string;
	resolve(): Promise<string>;
}

export interface ModelAssetOptions {
	emit?: boolean;
	cacheDir?: string;
}

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

function sha256(bytes: Buffer | string): string {
	return createHash('sha256').update(bytes).digest('hex');
}

async function hashFile(path: string): Promise<{ size: number; sha256: string }> {
	const hash = createHash('sha256');
	let size = 0;
	for await (const chunk of createReadStream(path)) {
		hash.update(chunk as Buffer);
		size += (chunk as Buffer).length;
	}
	return { size, sha256: hash.digest('hex') };
}

function packageFile(spec: string): string {
	const parts = spec.split('/');
	const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
	const rest = parts.slice(name.split('/').length).join('/');
	const require = createRequire(join(WORKSPACE, 'packages', 'core', 'package.json'));
	let dir = dirname(require.resolve(name));
	while (!existsSync(join(dir, 'package.json')) || JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name !== name) {
		const up = dirname(dir);
		if (up === dir) throw new Error(`model assets: cannot find package ${name}`);
		dir = up;
	}
	return join(dir, rest);
}

async function verified(path: string, want: { size?: number; sha256: string }, label: string): Promise<void> {
	const got = await hashFile(path);
	if ((want.size !== undefined && got.size !== want.size) || got.sha256 !== want.sha256) {
		throw new Error(`model assets: ${label} does not match the manifest (size ${got.size}, sha256 ${got.sha256})`);
	}
}

async function download(pinned: Pinned, file: PinnedFile, cacheDir: string): Promise<string> {
	const target = join(cacheDir, file.sha256);
	if (existsSync(target)) {
		const got = await hashFile(target);
		if (got.size === file.size && got.sha256 === file.sha256) return target;
		rmSync(target, { force: true });
	}
	mkdirSync(cacheDir, { recursive: true });
	const repo = new URL(pinned.model.conversion).pathname.replace(/^\/+/, '');
	const url = `${HUB}/${repo}/resolve/${pinned.model.revision}/${file.path}`;
	const res = await fetch(url, { redirect: 'follow' });
	if (!res.ok || !res.body) throw new Error(`model assets: ${file.path} fetch failed with ${res.status}`);
	const part = `${target}.${process.pid}.part`;
	try {
		await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(part));
		await verified(part, file, file.path);
		renameSync(part, target);
	} finally {
		rmSync(part, { force: true });
	}
	return target;
}

function locate(pinned: Pinned, cacheDir: string): { assets: ModelAssets; located: Located[] } {
	const located: Located[] = [];
	const files: Record<string, ModelAsset> = {};
	for (const file of pinned.files) {
		const ext = extname(file.path);
		const fileName = `${DIR}/${file.sha256}${ext}`;
		let pending: Promise<string> | null = null;
		const resolve =
			file.source === 'huggingface'
				? () => (pending ??= download(pinned, file, cacheDir))
				: () =>
						(pending ??= (async () => {
							const path = packageFile(file.path);
							await verified(path, file, file.path);
							return path;
						})());
		const entry = { url: `/${fileName}`, fileName, size: file.size, sha256: file.sha256, resolve };
		located.push(entry);
		files[file.id] = { url: entry.url, size: file.size, sha256: file.sha256 };
	}
	const licenses: string[] = [];
	for (const license of pinned.licenses) {
		const fileName = `${DIR}/${license.sha256}.txt`;
		const path = license.source === 'repo' ? join(WORKSPACE, license.path) : packageFile(license.path);
		if (located.some((l) => l.fileName === fileName)) continue;
		let pending: Promise<string> | null = null;
		const size = statSync(path).size;
		located.push({
			url: `/${fileName}`,
			fileName,
			size,
			sha256: license.sha256,
			resolve: () => (pending ??= verified(path, license, license.path).then(() => path))
		});
		licenses.push(`/${fileName}`);
	}
	const total = pinned.files.reduce((sum, f) => sum + f.size, 0);
	return { assets: { name: pinned.name, hash: '', total, files, licenses }, located };
}

export function modelAssets(options: ModelAssetOptions = {}): Plugin {
	const raw = readFileSync(MANIFEST_FILE, 'utf8');
	const pinned = JSON.parse(raw) as Pinned;
	const cacheDir = options.cacheDir ?? process.env.THELEMAIL_MODEL_CACHE ?? join(homedir(), '.cache', 'thelemail', 'models');
	const { assets, located } = locate(pinned, cacheDir);
	assets.hash = sha256(canonical(pinned));
	const emit = options.emit ?? true;
	return {
		name: 'thelemail:model-assets',
		resolveId(id) {
			return id === MANIFEST ? `\0${MANIFEST}` : null;
		},
		load(id) {
			if (id !== `\0${MANIFEST}`) return null;
			return `export default ${JSON.stringify(assets)};`;
		},
		configureServer(server) {
			if (!emit) return;
			server.middlewares.use((req, res, next) => {
				const path = (req.url ?? '').split('?')[0];
				const entry = located.find((l) => l.url === path);
				if (!entry) return next();
				entry
					.resolve()
					.then((file) => {
						res.setHeader('Content-Type', TYPES[extname(entry.fileName)] ?? 'application/octet-stream');
						res.setHeader('Content-Length', String(entry.size));
						createReadStream(file).pipe(res);
					})
					.catch((err: unknown) => {
						server.config.logger.error(String(err));
						res.statusCode = 500;
						res.end();
					});
			});
		},
		async generateBundle() {
			if (!emit || this.environment.config.consumer !== 'client') return;
			for (const entry of located) {
				const file = await entry.resolve();
				this.emitFile({ type: 'asset', fileName: entry.fileName, source: readFileSync(file) });
			}
		}
	};
}
