import { createHash } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { CDPSession } from 'playwright';
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

function serveLinkProbe(url: string | undefined, res: ServerResponse) {
	if (url?.includes('coop')) res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
	res.setHeader('Content-Type', 'text/html');
	res.end(PROBE_PAGE);
}

function linkProbe(): Plugin {
	return {
		name: 'link-probe',
		configureServer(server) {
			server.middlewares.use('/__link-probe', (req, res) => serveLinkProbe(req.url, res));
		}
	};
}

let external: Promise<Server> | undefined;

const linkProbeOrigin: BrowserCommand<[]> = async () => {
	external ??= new Promise((resolve) => {
		const server = createServer((req, res) => serveLinkProbe(req.url, res));
		server.unref();
		server.listen(0, '127.0.0.1', () => resolve(server));
	});
	const { port } = (await external).address() as AddressInfo;
	return `http://127.0.0.1:${port}`;
};

const clickMailLink: BrowserCommand<[selector: string]> = async (ctx, selector) => {
	const opened = ctx.context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
	await ctx.iframe.frameLocator('iframe.email-frame').locator(selector).click();
	const tab = await opened;
	if (!tab) return null;
	await tab
		.waitForFunction(() => document.title !== 'pending' && document.title !== '', null, { timeout: 3000 })
		.catch(() => {});
	const result = { url: tab.url(), title: await tab.title().catch(() => '') };
	await tab.close();
	return result;
};

interface VirtualAuthenticator {
	transport: 'usb' | 'internal';
	hasUserVerification: boolean;
	isUserVerified: boolean;
}

const cdpSessions = new Map<string, Promise<CDPSession>>();

function cdp(ctx: Parameters<BrowserCommand<[]>>[0]): Promise<CDPSession> {
	let session = cdpSessions.get(ctx.sessionId);
	if (!session) {
		session = ctx.page
			.context()
			.newCDPSession(ctx.page)
			.then(async (s) => {
				await s.send('WebAuthn.enable', { enableUI: false });
				return s;
			});
		cdpSessions.set(ctx.sessionId, session);
	}
	return session;
}

const addVirtualAuthenticator: BrowserCommand<[options: VirtualAuthenticator]> = async (ctx, options) => {
	const session = await cdp(ctx);
	const { authenticatorId } = await session.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			hasResidentKey: true,
			automaticPresenceSimulation: true,
			...options
		}
	});
	return authenticatorId;
};

const removeVirtualAuthenticator: BrowserCommand<[authenticatorId: string]> = async (ctx, authenticatorId) => {
	const session = await cdp(ctx);
	await session.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
};

export default mergeConfig(
	viteConfig,
	defineConfig({
		plugins: [submissionProbe(), linkProbe()],
		test: {
			env: {
				PUBLIC_API_BASE_URL: 'https://api.test.thelemail.local'
			},
			include: ['../../packages/*/src/**/*.browser.test.ts'],
			browser: {
				enabled: true,
				commands: { linkProbeOrigin, clickMailLink, addVirtualAuthenticator, removeVirtualAuthenticator },
				headless: true,
				provider: playwright(),
				instances: [{ browser: 'chromium' }, { browser: 'firefox' }, { browser: 'webkit' }]
			}
		}
	})
);
