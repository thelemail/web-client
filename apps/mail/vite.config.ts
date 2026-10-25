import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { inlineScriptHashes, loadBuildEnv, resolveOrigins } from '../../scripts/csp.ts';
import { i18nOptions } from '../../scripts/i18n.ts';
import { pdfjsAssets } from '../../scripts/pdfjs-assets.ts';
import { defineConfig } from 'vite';

const workspaceRoot = '../..';

const buildEnv = loadBuildEnv(workspaceRoot);
const origins = resolveOrigins(buildEnv);
const secure = origins.every((origin) => origin.startsWith('https://'));
const desktop = buildEnv.PUBLIC_THELEMAIL_TARGET === 'desktop';

const scriptHashes = inlineScriptHashes(readFileSync('src/app.html', 'utf8')).map(
	(source): `sha256-${string}` => `sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}`
);

export default defineConfig({
	plugins: [
		paraglideVitePlugin(i18nOptions('./src/lib/paraglide')),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			env: {
				dir: workspaceRoot
			},
			alias: {
				$core: '../../packages/core/src',
				$paraglide: 'src/lib/paraglide',
				$platform: desktop
					? process.env.THELEMAIL_PLATFORM_DIR ?? '../../packages/core/src/platform/web'
					: '../../packages/core/src/platform/web'
			},
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				precompress: false,
				strict: true
			}),
			...(desktop
				? {}
				: {
						csp: {
							mode: 'hash',
							directives: {
								'default-src': ['none'],
								'script-src': ['self', 'wasm-unsafe-eval', ...scriptHashes],
								'style-src': ['self', 'unsafe-inline'],
								'img-src': ['self', 'data:', 'blob:', 'cid:', ...origins],
								'font-src': ['self', 'data:'],
								'connect-src': ['self', ...origins],
								'worker-src': ['self'],
								'frame-src': ['self'],
								'object-src': ['none'],
								'base-uri': ['none'],
								'form-action': ['none'],
								...(secure ? { 'upgrade-insecure-requests': true } : {})
							}
						}
					}),
			version: {
				pollInterval: desktop ? 0 : 60000
			}
		}),
		pdfjsAssets(import.meta.dirname)
	],
	envPrefix: ['VITE_', 'PUBLIC_'],
	envDir: workspaceRoot,
	server: {
		fs: {
			allow: [workspaceRoot]
		}
	},
	resolve: {
		alias: [
			{ find: /^core-js\/stable$/, replacement: '/src/lib/empty-module.ts' },
			{
				find: /^core-js\/proposals\/array-buffer-base64$/,
				replacement: '/src/lib/empty-module.ts'
			}
		]
	},
	worker: {
		format: 'es'
	}
});
