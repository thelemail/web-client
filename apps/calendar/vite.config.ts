import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { i18nOptions } from '../../scripts/i18n.ts';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		paraglideVitePlugin(i18nOptions('./src/lib/paraglide')),
		tailwindcss(),
		sveltekit()
	],
	envPrefix: ['VITE_', 'PUBLIC_'],
	envDir: '../..',
	server: {
		fs: {
			allow: ['../..']
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
