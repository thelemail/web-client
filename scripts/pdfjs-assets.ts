import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize, sep } from 'node:path';
import type { Plugin } from 'vite';

const DIRS = ['wasm', 'standard_fonts', 'cmaps', 'iccs'];
const PREFIX = 'pdfjs';

const TYPES: Record<string, string> = {
	'.wasm': 'application/wasm',
	'.js': 'text/javascript'
};

function pdfjsRoot(from: string): string {
	const require = createRequire(join(from, 'package.json'));
	return dirname(require.resolve('pdfjs-dist/package.json'));
}

export function pdfjsAssets(appRoot: string): Plugin {
	const root = pdfjsRoot(appRoot);
	return {
		name: 'thelemail:pdfjs-assets',
		configureServer(server) {
			server.middlewares.use(`/${PREFIX}/`, (req, res, next) => {
				const rel = normalize(decodeURIComponent((req.url ?? '').split('?')[0])).replace(/^[/\\]+/, '');
				const [dir] = rel.split(sep);
				if (!DIRS.includes(dir) || rel.includes('..')) return next();
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
			for (const dir of DIRS) {
				for (const name of readdirSync(join(root, dir))) {
					this.emitFile({
						type: 'asset',
						fileName: `${PREFIX}/${dir}/${name}`,
						source: readFileSync(join(root, dir, name))
					});
				}
			}
		}
	};
}
