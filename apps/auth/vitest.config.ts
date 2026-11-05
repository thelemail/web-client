import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
	viteConfig,
	defineConfig({
		resolve: { conditions: ['browser'] },
		test: {
			environment: 'jsdom',
			env: {
				PUBLIC_API_BASE_URL: 'https://auth.test.thelemail.local'
			},
			globals: false,
			include: ['src/**/*.{test,spec}.ts'],
			exclude: ['**/node_modules/**', '**/*.browser.test.ts'],
			setupFiles: ['./vitest.setup.ts']
		}
	})
);
