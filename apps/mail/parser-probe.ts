import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import type { Request } from 'playwright';
import type { BrowserCommand } from 'vitest/node';

const APP = join(import.meta.dirname, '..', 'parser');
const BUILD = join(APP, 'build');
const WORKER_CSP = "default-src 'none'; connect-src 'none'; worker-src 'none'; script-src 'wasm-unsafe-eval'";
const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.bcmap': 'application/octet-stream',
	'.pfb': 'application/octet-stream',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain'
};

export interface ParserRequest {
	path: string;
	cookie: string | null;
}

interface Running {
	server: Server;
	origin: string;
	log: ParserRequest[];
}

let running: Promise<Running> | undefined;
const network = new Map<string, string[]>();

function pageCsp(): string {
	const line = readFileSync(join(APP, 'build-meta', 'csp.caddy'), 'utf8');
	const value = line.match(/"([^"]+)"/)?.[1];
	if (!value) throw new Error('parser build has no content-security-policy');
	return value;
}

function start(appOrigin: string): Promise<Running> {
	return new Promise((resolve, reject) => {
		const log: ParserRequest[] = [];
		const server = createServer();
		server.unref();
		server.listen(0, '127.0.0.1', () => {
			const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
			try {
				execFileSync('pnpm', ['build'], {
					cwd: APP,
					stdio: 'pipe',
					env: { ...process.env, PUBLIC_PRODUCT_ORIGINS: `app=${appOrigin}`, PUBLIC_PARSER_ORIGIN: origin }
				});
			} catch (error) {
				reject(error);
				return;
			}
			const csp = pageCsp();
			server.on('request', (req, res) => {
				const path = (req.url ?? '/').split(/[?#]/)[0];
				log.push({ path, cookie: req.headers.cookie ?? null });
				res.setHeader('X-Content-Type-Options', 'nosniff');
				res.setHeader('Referrer-Policy', 'no-referrer');
				res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
				if (req.headers['service-worker']) {
					res.writeHead(403).end();
					return;
				}
				const worker = path.startsWith('/_app/immutable/workers/');
				res.setHeader('Content-Security-Policy', worker ? WORKER_CSP : csp);
				let file = normalize(join(BUILD, decodeURIComponent(path)));
				if (!file.startsWith(BUILD)) {
					res.writeHead(404).end();
					return;
				}
				try {
					if (!statSync(file).isFile()) file = join(BUILD, 'index.html');
				} catch {
					file = join(BUILD, 'index.html');
				}
				res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
				res.end(readFileSync(file));
			});
			resolve({ server, origin, log });
		});
	});
}

export const parserOrigin: BrowserCommand<[appOrigin: string]> = async (_ctx, appOrigin) => {
	running ??= start(appOrigin);
	return (await running).origin;
};

export const parserRequests: BrowserCommand<[]> = async () => {
	if (!running) return [];
	return [...(await running).log];
};

export const watchNetwork: BrowserCommand<[]> = async (ctx) => {
	const seen: string[] = [];
	network.set(ctx.sessionId, seen);
	const record = (request: Request) => {
		if (network.get(ctx.sessionId) === seen) seen.push(request.url());
	};
	ctx.context.on('request', record);
	return null;
};

export const networkSeen: BrowserCommand<[]> = async (ctx) => {
	const seen = network.get(ctx.sessionId) ?? [];
	network.delete(ctx.sessionId);
	return seen;
};

export const frameDatabases: BrowserCommand<[origin: string]> = async (ctx, origin) => {
	const frame = ctx.page.frames().find((f) => f.url().startsWith(origin));
	if (!frame) return null;
	return frame.evaluate(async () => {
		try {
			return (await indexedDB.databases()).map((d) => d.name ?? '');
		} catch (error) {
			return [`error:${(error as Error).name}`];
		}
	});
};
