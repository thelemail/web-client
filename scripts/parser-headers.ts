import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBuildEnv } from './csp.ts';

const app = process.cwd();
const html = readFileSync(join(app, 'build', 'index.html'), 'utf8');
const meta = html.match(/<meta http-equiv="content-security-policy" content="([^"]+)"/);
if (!meta) {
	throw new Error('parser build has no hashed content-security-policy to promote to a header');
}
const policy = meta[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

for (const directive of ["default-src 'none'", "object-src 'none'", "base-uri 'none'", "connect-src 'self'", "worker-src 'self'", "form-action 'none'"]) {
	if (!policy.includes(directive)) {
		throw new Error(`parser content-security-policy lost ${directive}`);
	}
}
if (/'unsafe-eval'|'unsafe-inline'|'wasm-unsafe-eval'|'strict-dynamic'|\*/.test(policy)) {
	throw new Error('parser content-security-policy admits eval, inline code or a wildcard source');
}

const env = { ...loadBuildEnv(join(app, '..', '..')), ...process.env };
const parent = (env.PUBLIC_PRODUCT_ORIGINS ?? '')
	.split(',')
	.map((entry) => entry.split('=').map((part) => part.trim()))
	.find(([audience]) => audience === 'app')?.[1];
if (!parent) {
	throw new Error('PUBLIC_PRODUCT_ORIGINS has no app origin to allow as the parser frame ancestor');
}
const ancestor = new URL(parent).origin;

const header = `${policy}; frame-ancestors ${ancestor}`;
if (header.includes('"')) {
	throw new Error('parser content-security-policy contains a double quote');
}
mkdirSync(join(app, 'build-meta'), { recursive: true });
writeFileSync(join(app, 'build-meta', 'csp.caddy'), `header @page Content-Security-Policy "${header}"\n`);
console.log(`parser-headers: frame-ancestors ${ancestor}`);
