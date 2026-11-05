import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { inlineScriptHashes, loadBuildEnv } from '../../scripts/csp.ts';
import { i18nOptions } from '../../scripts/i18n.ts';
import { moduleInventory } from '../../scripts/module-inventory.ts';
import { defineConfig } from 'vite';

const workspaceRoot = '../..';

const buildEnv = loadBuildEnv(workspaceRoot);
const apiOrigin = new URL(buildEnv.PUBLIC_API_BASE_URL ?? 'http://localhost:5177').origin;
const authOrigin = (buildEnv.PUBLIC_PRODUCT_ORIGINS ?? '')
	.split(',')
	.map((entry) => entry.split('='))
	.find(([audience]) => audience?.trim() === 'auth')?.[1]
	?.trim();
const building = process.argv.includes('build');
if (building && (!authOrigin || new URL(authOrigin).origin !== apiOrigin)) {
	throw new Error(
		`the auth app must call its own origin; PUBLIC_API_BASE_URL is ${apiOrigin}, auth is ${authOrigin}`
	);
}
const secure = apiOrigin.startsWith('https://');
const devApi = process.env.THELEMAIL_DEV_API ?? 'http://127.0.0.1:8080';

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
				$platform: '../../packages/core/src/platform/auth'
			},
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				precompress: false,
				strict: true
			}),
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['none'],
					'script-src': ['self', 'wasm-unsafe-eval', ...scriptHashes],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:'],
					'font-src': ['self'],
					'connect-src': ['self'],
					'worker-src': ['self'],
					'manifest-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['none'],
					'form-action': ['self'],
					'require-trusted-types-for': ['script'],
					'trusted-types': ['svelte-trusted-html', 'default'],
					...(secure ? { 'upgrade-insecure-requests': true } : {})
				}
			},
			serviceWorker: {
				register: false
			},
			version: {
				pollInterval: 60000
			}
		}),
		moduleInventory(import.meta.dirname, 'app')
	],
	envPrefix: ['VITE_', 'PUBLIC_'],
	envDir: workspaceRoot,
	server: {
		port: 5177,
		strictPort: true,
		fs: {
			allow: [workspaceRoot]
		},
		proxy: {
			'/v1': {
				target: devApi,
				changeOrigin: false,
				xfwd: false
			}
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
		format: 'es',
		plugins: () => [moduleInventory(import.meta.dirname, 'worker')]
	}
});
