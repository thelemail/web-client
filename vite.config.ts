import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
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
