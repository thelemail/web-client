import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			environment: 'node',
			globals: false,
			include: ['src/**/*.{test,spec}.ts'],
			exclude: ['**/node_modules/**', '**/*.browser.test.ts']
		}
	})
);
