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

const TYPES: Record<string, string> = {
	'.wasm': 'application/wasm',
	'.js': 'text/javascript'
};

export interface PdfjsAssetOptions {
	dirs?: readonly string[];
	manifest?: boolean;
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

export function pdfjsAssets(appRoot: string, options: PdfjsAssetOptions = {}): Plugin {
	const root = pdfjsRoot(appRoot);
	const dirs = options.dirs ?? ALL_DIRS;
	return {
		name: 'thelemail:pdfjs-assets',
		resolveId(id) {
			if (options.manifest && id === MANIFEST) return `\0${MANIFEST}`;
			return null;
		},
		load(id) {
			if (id !== `\0${MANIFEST}`) return null;
			const entries = files(root, dirs)
				.filter(({ name }) => !UNVERIFIED.test(name))
				.map(({ dir, name }) => {
					const bytes = readFileSync(join(root, dir, name));
					return {
						id: `${dir}/${name}`,
						path: `/${PREFIX}/${dir}/${name}`,
						size: bytes.length,
						sha256: createHash('sha256').update(bytes).digest('hex')
					};
				});
			return `export default ${JSON.stringify(entries)};`;
		},
		configureServer(server) {
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
			for (const { dir, name } of files(root, dirs)) {
				this.emitFile({
					type: 'asset',
					fileName: `${PREFIX}/${dir}/${name}`,
					source: readFileSync(join(root, dir, name))
				});
			}
		}
	};
}
