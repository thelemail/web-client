import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { defineConfig, mergeConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import viteConfig from './vite.config.ts';

function submissionProbe(): Plugin {
	return {
		name: 'submission-probe',
		configureServer(server) {
			server.middlewares.use('/__submission-probe', (req, res) => {
				const hash = createHash('sha256');
				let bytes = 0;
				req.on('data', (chunk: Buffer) => {
					bytes += chunk.length;
					hash.update(chunk);
				});
				req.on('end', () => {
					res.setHeader('Content-Type', 'application/json');
					res.end(
						JSON.stringify({
							method: req.method,
							bytes,
							sha256: hash.digest('hex'),
							contentLength: Number(req.headers['content-length'] ?? -1),
							contentType: req.headers['content-type'] ?? '',
							authorization: req.headers['authorization'] ?? '',
							accountId: req.headers['x-account-id'] ?? ''
						})
					);
				});
			});
		}
	};
}

export default mergeConfig(
	viteConfig,
	defineConfig({
		plugins: [submissionProbe()],
		test: {
			env: {
				PUBLIC_API_BASE_URL: 'https://api.test.thelemail.local',
				PUBLIC_BLOB_ORIGIN: 'https://blob.test.thelemail.local'
			},
			include: ['../../packages/*/src/**/*.browser.test.ts'],
			browser: {
				enabled: true,
				headless: true,
				provider: playwright(),
				instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }]
			}
		}
	})
);
