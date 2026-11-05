import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const [base, buildDir] = process.argv.slice(2);
if (!base || !buildDir) {
	console.error('usage: node scripts/check-auth-host.mjs <base-url> <build-dir>');
	process.exit(2);
}

function assets(dir, rel = '_app/immutable') {
	return readdirSync(join(dir, rel), { withFileTypes: true }).flatMap((entry) => {
		const path = `${rel}/${entry.name}`;
		if (entry.isDirectory()) return assets(dir, path);
		return path.endsWith('.js') ? [`/${path}`] : [];
	});
}

const all = assets(buildDir);
const worker = all.find((p) => /\/workers\/auth-worker-[^/]+\.js$/.test(p));
const chunk = all.find((p) => !p.includes('/workers/'));
if (!worker || !chunk) {
	console.error('check-auth-host: build has no auth worker or app chunk');
	process.exit(1);
}

const EXACT = [
	['x-content-type-options', 'nosniff'],
	['referrer-policy', 'no-referrer'],
	['cross-origin-opener-policy', 'same-origin'],
	['cross-origin-embedder-policy', 'require-corp'],
	['cross-origin-resource-policy', 'same-origin']
];
const CSP = [
	"default-src 'none'",
	"frame-ancestors 'none'",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'none'",
	"require-trusted-types-for 'script'",
	'trusted-types svelte-trusted-html default'
];

const failures = [];

async function check(path, status, cache) {
	const res = await fetch(new URL(path, base), { redirect: 'manual' });
	await res.arrayBuffer();
	const problems = [];
	if (res.status !== status) problems.push(`status ${res.status}, want ${status}`);
	if (cache && res.headers.get('cache-control') !== cache) {
		problems.push(`cache-control ${JSON.stringify(res.headers.get('cache-control'))}, want ${JSON.stringify(cache)}`);
	}
	for (const [name, value] of EXACT) {
		if (res.headers.get(name) !== value) problems.push(`${name} ${JSON.stringify(res.headers.get(name))}`);
	}
	const csp = res.headers.get('content-security-policy') ?? '';
	for (const directive of CSP) {
		if (!csp.includes(directive)) problems.push(`content-security-policy lacks ${directive}`);
	}
	if (/'unsafe-eval'/.test(csp)) problems.push("content-security-policy admits 'unsafe-eval'");
	if (res.headers.get('server')) problems.push(`server header ${res.headers.get('server')}`);
	if (problems.length) failures.push(`${path}: ${problems.join('; ')}`);
}

for (const path of ['/', '/login', '/register', '/recover', '/u/0']) await check(path, 200, 'no-store');
for (const path of [worker, chunk]) await check(path, 200, 'public, max-age=31536000, immutable');
await check('/robots.txt', 200, 'no-store');
for (const path of ['/.env', '/.git/config', '/package.json', '/_app/immutable/missing.js']) {
	await check(path, 404, 'no-store');
}

if (failures.length) {
	for (const f of failures) console.error(`check-auth-host: ${f}`);
	process.exit(1);
}
console.log(`check-auth-host: headers hold on ${base}`);
