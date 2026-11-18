import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const [base, buildDir, ancestor] = process.argv.slice(2);
if (!base || !buildDir || !ancestor) {
	console.error('usage: node scripts/check-parser-host.mjs <base-url> <build-dir> <app-origin>');
	process.exit(2);
}

const workers = readdirSync(join(buildDir, '_app', 'immutable', 'workers')).filter((n) => n.endsWith('.js'));
const chunk = readdirSync(join(buildDir, '_app', 'immutable', 'entry')).find((n) => n.endsWith('.js'));
const asset = readdirSync(join(buildDir, '_app', 'immutable', 'assets')).find((n) => /^pdfjs-[0-9a-f]{16}\.bin$/.test(n));
if (workers.length !== 1 || !chunk || !asset) {
	console.error('check-parser-host: build lacks the worker, an entry chunk or the pdf.js assets');
	process.exit(1);
}
const worker = `/_app/immutable/workers/${workers[0]}`;

const WORKER_CSP = "default-src 'none'; connect-src 'none'; worker-src 'none'; script-src 'wasm-unsafe-eval'";
const EXACT = [
	['x-content-type-options', 'nosniff'],
	['referrer-policy', 'no-referrer'],
	['cross-origin-resource-policy', 'same-origin']
];
const PAGE_CSP = ["default-src 'none'", "connect-src 'self'", "worker-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", `frame-ancestors ${ancestor}`];

const failures = [];

async function check(path, { status = 200, method = 'GET', headers = {}, csp = 'page', cache = null } = {}) {
	const res = await fetch(new URL(path, base), { method, headers, redirect: 'manual' });
	await res.arrayBuffer();
	const problems = [];
	if (res.status !== status) problems.push(`status ${res.status}, want ${status}`);
	if (res.headers.get('set-cookie')) problems.push('sets a cookie');
	if (res.headers.get('server')) problems.push(`server header ${res.headers.get('server')}`);
	if (status === 200) {
		for (const [name, value] of EXACT) {
			if (res.headers.get(name) !== value) problems.push(`${name} ${JSON.stringify(res.headers.get(name))}`);
		}
		if (cache && res.headers.get('cache-control') !== cache) problems.push(`cache-control ${JSON.stringify(res.headers.get('cache-control'))}`);
		const policy = res.headers.get('content-security-policy') ?? '';
		if (csp === 'worker' && policy !== WORKER_CSP) problems.push(`worker content-security-policy ${JSON.stringify(policy)}`);
		if (csp === 'page') {
			for (const directive of PAGE_CSP) if (!policy.includes(directive)) problems.push(`content-security-policy lacks ${directive}`);
			if (/'unsafe-|\*/.test(policy)) problems.push('content-security-policy admits unsafe sources');
		}
	}
	if (problems.length) failures.push(`${method} ${path}: ${problems.join('; ')}`);
}

await check('/');
await check(`/_app/immutable/entry/${chunk}`);
await check(`/_app/immutable/assets/${asset}`, { cache: 'public, max-age=31536000, immutable' });
await check('/pdfjs/cmaps/Adobe-Japan1-UCS2.bcmap', { status: 404 });
await check(worker, { csp: 'worker' });
await check(worker, { status: 403, headers: { 'Service-Worker': 'script' } });
await check('/', { status: 405, method: 'POST' });

if (failures.length) {
	for (const f of failures) console.error(`check-parser-host: ${f}`);
	process.exit(1);
}
console.log(`check-parser-host: headers hold on ${base}`);
