import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const [base, buildDir] = process.argv.slice(2);
if (!base || !buildDir) {
	console.error('usage: node scripts/check-static-host.mjs <base-url> <build-dir>');
	process.exit(2);
}

function firstImmutableAsset(dir, rel = '_app/immutable') {
	for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
		const path = `${rel}/${entry.name}`;
		if (entry.isFile() && path.endsWith('.js')) return `/${path}`;
		if (entry.isDirectory()) {
			const found = firstImmutableAsset(dir, path);
			if (found) return found;
		}
	}
	return null;
}

const SHELL_404 = [
	'/.git',
	'/.git/',
	'/.git/HEAD',
	'/.git/config',
	'/.GIT/config',
	'/%2egit/HEAD',
	'/.env',
	'/.env.production',
	'/.aws/credentials',
	'/.DS_Store',
	'/package.json',
	'/pnpm-lock.yaml',
	'/Dockerfile.bak',
	'/wp-login.php',
	'/X.PHP',
	'/.well-known/security.txt',
	'/_app/immutable/missing.js'
];

const SHELL_200 = [
	'/',
	'/login',
	'/nonexistent-xyz',
	'/u/0/mail/inbox',
	'/u/0/mail/inbox/9b2f3c1e-1111-4a2b-9c3d-123456789abc',
	'/u/0/calendar',
	'/invite/abc_-XYZ'
];

const FILES_200 = [
	'/robots.txt',
	'/.well-known/assetlinks.json',
	'/.well-known/apple-app-site-association'
];

const SECURITY_HEADERS = [
	['content-security-policy', "frame-ancestors 'none'"],
	['x-content-type-options', 'nosniff'],
	['referrer-policy', 'no-referrer'],
	['cross-origin-opener-policy', 'same-origin'],
	['cross-origin-resource-policy', 'same-origin']
];

const failures = [];

async function expect(path, status, { shell = false, cache } = {}) {
	const res = await fetch(new URL(path, base), { redirect: 'manual' });
	const body = await res.text();
	const problems = [];
	if (res.status !== status) problems.push(`status ${res.status}, want ${status}`);
	if (shell && !body.includes('<html')) problems.push('body is not the app shell');
	if (cache && res.headers.get('cache-control') !== cache) {
		problems.push(`cache-control ${JSON.stringify(res.headers.get('cache-control'))}, want ${JSON.stringify(cache)}`);
	}
	for (const [name, value] of SECURITY_HEADERS) {
		if (res.headers.get(name) !== value) problems.push(`${name} ${JSON.stringify(res.headers.get(name))}`);
	}
	if (res.headers.has('server')) problems.push(`server header ${JSON.stringify(res.headers.get('server'))}`);
	if (problems.length) failures.push(`${path}: ${problems.join('; ')}`);
}

for (const path of SHELL_404) await expect(path, 404, { shell: true, cache: 'no-cache' });
for (const path of SHELL_200) await expect(path, 200, { shell: true, cache: 'no-cache' });
for (const path of FILES_200) await expect(path, 200, { cache: 'no-cache' });

const asset = firstImmutableAsset(buildDir);
if (!asset) failures.push(`no immutable asset under ${buildDir}/_app/immutable`);
else await expect(asset, 200, { cache: 'public, max-age=31536000, immutable' });

if (failures.length) {
	console.error(`static host check failed for ${buildDir}:`);
	for (const failure of failures) console.error(`  ${failure}`);
	process.exit(1);
}
console.log(`static host check passed for ${buildDir}`);
