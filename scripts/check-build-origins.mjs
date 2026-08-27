import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { loadBuildEnv, resolveOrigins } from './csp.ts';

const BUILD_DIR = 'build';
const SCANNED = new Set(['.js', '.mjs', '.css', '.html', '.json', '.map', '.webmanifest']);
const ABSOLUTE = String.raw`(?:[a-z][a-z0-9+.-]*:)?\/\/`;

const SUBRESOURCE = [
	[new RegExp(String.raw`\b(?:src|srcset|poster|data)\s*=\s*["']?(${ABSOLUTE}[^"'\s>]+)`, 'gi'), 'element source'],
	[new RegExp(String.raw`<link\b[^>]*\bhref\s*=\s*["']?(${ABSOLUTE}[^"'\s>]+)`, 'gi'), 'link href'],
	[new RegExp(String.raw`url\(\s*["']?(${ABSOLUTE}[^"')\s]+)`, 'gi'), 'css url()'],
	[new RegExp(String.raw`@import\s+(?:url\(\s*)?["'](${ABSOLUTE}[^"')\s]+)`, 'gi'), 'css @import'],
	[new RegExp(String.raw`\bfrom\s*["'](${ABSOLUTE}[^"']+)["']`, 'g'), 'static import'],
	[new RegExp(String.raw`\bimport\s*\(\s*["'](${ABSOLUTE}[^"']+)["']`, 'g'), 'dynamic import'],
	[new RegExp(String.raw`\bimportScripts\s*\(\s*["'](${ABSOLUTE}[^"']+)["']`, 'g'), 'importScripts']
];

const LOOPBACK = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/gi;
const LOOPBACK_HOST = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?$/i;
const ANY_ORIGIN = /https?:\/\/[a-z0-9._-]+(?::\d+)?/gi;

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* walk(path);
		else if (SCANNED.has(extname(path))) yield path;
	}
}

function toOrigin(raw) {
	try {
		return new URL(raw.startsWith('//') ? `https:${raw}` : raw).origin;
	} catch {
		return null;
	}
}

function context(text, index) {
	return text.slice(Math.max(0, index - 40), index + 60).replace(/\s+/g, ' ');
}

const env = loadBuildEnv();
const allowed = new Set(resolveOrigins(env));
const inert = new Set(JSON.parse(readFileSync(new URL('./allowed-origins.json', import.meta.url), 'utf8')).inert);
const production = [...allowed].every((origin) => origin.startsWith('https://'));

const loads = [];
const loopback = [];
const unknown = new Map();

for (const file of walk(BUILD_DIR)) {
	const text = readFileSync(file, 'utf8');

	for (const [pattern, kind] of SUBRESOURCE) {
		for (const match of text.matchAll(pattern)) {
			const origin = toOrigin(match[1]);
			if (origin && !allowed.has(origin)) {
				loads.push(`${file}: ${kind} loads ${match[1]}`);
			}
		}
	}

	if (production) {
		for (const match of text.matchAll(LOOPBACK)) {
			loopback.push(`${file}: ${match[0]} in ...${context(text, match.index)}...`);
		}
	}

	for (const match of text.matchAll(ANY_ORIGIN)) {
		const origin = toOrigin(match[0]);
		if (!origin || allowed.has(origin) || inert.has(origin)) continue;
		if (!production && LOOPBACK_HOST.test(origin)) continue;
		if (!unknown.has(origin)) unknown.set(origin, `${file}: ...${context(text, match.index)}...`);
	}
}

let failed = false;

if (loads.length > 0) {
	failed = true;
	console.error('Third-party subresource loads in build/:');
	for (const line of loads) console.error(`  ${line}`);
}

if (loopback.length > 0) {
	failed = true;
	console.error('Loopback addresses in a production build:');
	for (const line of loopback.slice(0, 20)) console.error(`  ${line}`);
	console.error('  The PUBLIC_* build configuration was probably missing, so a local .env leaked into the bundle.');
}

if (unknown.size > 0) {
	failed = true;
	console.error('Origins in build/ that are neither configured nor recognised:');
	for (const [origin, where] of unknown) console.error(`  ${origin}\n    ${where}`);
	console.error('  Add it to the CSP if the client fetches it, or to scripts/allowed-origins.json if it is inert text.');
}

if (failed) process.exit(1);

console.log(`build/ contacts only: ${[...allowed].sort().join(' ')}`);
