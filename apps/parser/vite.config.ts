import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { loadBuildEnv } from '../../scripts/csp.ts';
import { moduleInventory } from '../../scripts/module-inventory.ts';
import { pdfjsAssets } from '../../scripts/pdfjs-assets.ts';

const workspaceRoot = '../..';
const buildEnv = loadBuildEnv(workspaceRoot);
const parserOrigin = buildEnv.PUBLIC_PARSER_ORIGIN ? new URL(buildEnv.PUBLIC_PARSER_ORIGIN) : null;
const secure = parserOrigin?.protocol === 'https:';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
			},
			env: {
				dir: workspaceRoot
			},
			alias: {
				$core: '../../packages/core/src'
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
					'script-src': ['self'],
					'connect-src': ['self'],
					'worker-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['none'],
					'form-action': ['none'],
					...(secure ? { 'upgrade-insecure-requests': true } : {})
				}
			},
			serviceWorker: {
				register: false
			}
		}),
		pdfjsAssets(import.meta.dirname, { dirs: ['cmaps', 'standard_fonts'], manifest: true }),
		moduleInventory(import.meta.dirname, 'app')
	],
	envPrefix: ['VITE_', 'PUBLIC_'],
	envDir: workspaceRoot,
	server: {
		host: parserOrigin?.hostname ?? '127.0.0.1',
		port: Number(parserOrigin?.port || 5178),
		strictPort: true,
		fs: {
			allow: [workspaceRoot]
		}
	},
	worker: {
		format: 'es',
		plugins: () => [moduleInventory(import.meta.dirname, 'worker')],
		rolldownOptions: {
			output: {
				codeSplitting: false
			}
		}
	}
});
