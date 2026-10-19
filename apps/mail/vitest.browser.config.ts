import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Plugin } from 'vite';
import type { BrowserCommand } from 'vitest/node';
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

const PROBE_PAGE =
	'<!doctype html><html><head><title>pending</title></head><body><script>' +
	'document.title = JSON.stringify({ ran: true, opener: window.opener !== null, referrer: document.referrer });' +
	'</script></body></html>';

let probe: Promise<Server> | undefined;

function linkProbe(): Promise<Server> {
	probe ??= new Promise((resolve) => {
		const server = createServer((req, res) => {
			if (req.url?.startsWith('/coop')) res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
			res.setHeader('Content-Type', 'text/html');
			res.end(PROBE_PAGE);
		});
		server.unref();
		server.listen(0, '127.0.0.1', () => resolve(server));
	});
	return probe;
}

const linkProbeOrigin: BrowserCommand<[]> = async () => {
	const { port } = (await linkProbe()).address() as AddressInfo;
	return `http://127.0.0.1:${port}`;
};

const clickMailLink: BrowserCommand<[text: string, modified?: boolean]> = async (ctx, text, modified) => {
	if (!('context' in ctx)) throw new Error('clickMailLink needs the playwright provider');
	const opened = ctx.context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
	await ctx.iframe
		.frameLocator('iframe.email-frame')
		.getByRole('link', { name: text, exact: true })
		.click({ modifiers: modified ? ['ControlOrMeta'] : [] });
	const tab = await opened;
	if (!tab) return null;
	await tab.waitForFunction(() => document.title !== 'pending' && document.title !== '', null, { timeout: 3000 }).catch(() => {});
	const result = { url: tab.url(), title: await tab.title().catch(() => '') };
	await tab.close();
	return result;
};

export default mergeConfig(
	viteConfig,
	defineConfig({
		plugins: [submissionProbe()],
		test: {
			env: {
				PUBLIC_API_BASE_URL: 'https://api.test.thelemail.local'
			},
			include: ['../../packages/*/src/**/*.browser.test.ts'],
			browser: {
				enabled: true,
				commands: { linkProbeOrigin, clickMailLink },
				headless: true,
				provider: playwright(),
				instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }]
			}
		}
	})
);
