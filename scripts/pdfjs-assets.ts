import { createHash } from 'node:crypto';
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, normalize, sep } from 'node:path';
import type { Plugin } from 'vite';

const ALL_DIRS = ['wasm', 'standard_fonts', 'cmaps', 'iccs'];
const PREFIX = 'pdfjs';
const EXCLUDED = /^quickjs-eval\./;
const UNVERIFIED = /^LICENSE/;
const MANIFEST = 'virtual:parser-assets';
const BUNDLE_DIR = '_app/immutable/assets';

const TYPES: Record<string, string> = {
	'.wasm': 'application/wasm',
	'.js': 'text/javascript'
};

export interface PdfjsAssetOptions {
	dirs?: readonly string[];
	manifest?: boolean;
}

interface Bundle {
	fileName: string;
	bytes: Buffer;
	manifest: {
		path: string;
		size: number;
		sha256: string;
		entries: { id: string; offset: number; size: number; sha256: string }[];
	};
}

function pdfjsRoot(from: string): string {
	const require = createRequire(join(from, 'package.json'));
	return dirname(require.resolve('pdfjs-dist/package.json'));
}

function files(root: string, dirs: readonly string[]): { dir: string; name: string }[] {
	return dirs.flatMap((dir) =>
		readdirSync(join(root, dir))
			.filter((name) => !EXCLUDED.test(name))
			.sort()
			.map((name) => ({ dir, name }))
	);
}

function sha256(bytes: Buffer): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function buildBundle(root: string, dirs: readonly string[]): Bundle {
	const parts: Buffer[] = [];
	const entries: Bundle['manifest']['entries'] = [];
	let offset = 0;
	for (const { dir, name } of files(root, dirs)) {
		if (UNVERIFIED.test(name)) continue;
		const bytes = readFileSync(join(root, dir, name));
		entries.push({ id: `${dir}/${name}`, offset, size: bytes.length, sha256: sha256(bytes) });
		parts.push(bytes);
		offset += bytes.length;
	}
	const bytes = Buffer.concat(parts);
	const digest = sha256(bytes);
	const fileName = `${BUNDLE_DIR}/pdfjs-${digest.slice(0, 16)}.bin`;
	return { fileName, bytes, manifest: { path: `/${fileName}`, size: bytes.length, sha256: digest, entries } };
}

export function pdfjsAssets(appRoot: string, options: PdfjsAssetOptions = {}): Plugin {
	const root = pdfjsRoot(appRoot);
	const dirs = options.dirs ?? ALL_DIRS;
	let cached: Bundle | null = null;
	const bundle = () => (cached ??= buildBundle(root, dirs));
	return {
		name: 'thelemail:pdfjs-assets',
		resolveId(id) {
			if (options.manifest && id === MANIFEST) return `\0${MANIFEST}`;
			return null;
		},
		load(id) {
			if (id !== `\0${MANIFEST}`) return null;
			return `export default ${JSON.stringify(bundle().manifest)};`;
		},
		configureServer(server) {
			if (options.manifest) {
				server.middlewares.use((req, res, next) => {
					const { manifest, bytes } = bundle();
					if ((req.url ?? '').split('?')[0] !== manifest.path) return next();
					res.setHeader('Content-Type', 'application/octet-stream');
					res.end(bytes);
				});
				return;
			}
			server.middlewares.use(`/${PREFIX}/`, (req, res, next) => {
				const rel = normalize(decodeURIComponent((req.url ?? '').split('?')[0])).replace(/^[/\\]+/, '');
				const [dir] = rel.split(sep);
				if (!dirs.includes(dir) || rel.includes('..') || EXCLUDED.test(basename(rel))) return next();
				const file = join(root, rel);
				try {
					if (!statSync(file).isFile()) return next();
				} catch {
					return next();
				}
				const ext = file.slice(file.lastIndexOf('.'));
				res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
				createReadStream(file).pipe(res);
			});
		},
		generateBundle() {
			if (this.environment.config.consumer !== 'client') return;
			if (options.manifest) {
				const { fileName, bytes } = bundle();
				this.emitFile({ type: 'asset', fileName, source: bytes });
			}
			for (const { dir, name } of files(root, dirs)) {
				if (options.manifest && !UNVERIFIED.test(name)) continue;
				this.emitFile({
					type: 'asset',
					fileName: `${PREFIX}/${dir}/${name}`,
					source: readFileSync(join(root, dir, name))
				});
			}
		}
	};
}
