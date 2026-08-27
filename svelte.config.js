import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-static';
import { inlineScriptHashes, loadBuildEnv, resolveOrigins } from './scripts/csp.ts';

const origins = resolveOrigins(loadBuildEnv());
const secure = origins.every((origin) => origin.startsWith('https://'));

const scriptHashes = inlineScriptHashes(readFileSync('src/app.html', 'utf8')).map(
	(source) => `sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}`
);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
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
		},
		version: {
			pollInterval: 60000
		}
	}
};

export default config;
