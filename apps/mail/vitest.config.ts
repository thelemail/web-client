import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
	viteConfig,
	defineConfig({
		resolve: { conditions: ['browser'] },
		test: {
			environment: 'jsdom',
			env: {
				PUBLIC_API_BASE_URL: 'https://api.test.thelemail.local',
				PUBLIC_BLOB_ORIGIN: 'https://blob.test.thelemail.local'
			},
			globals: false,
			include: ['src/**/*.{test,spec}.ts', '../../packages/*/src/**/*.{test,spec}.ts'],
			setupFiles: ['./vitest.setup.ts']
		}
	})
);
