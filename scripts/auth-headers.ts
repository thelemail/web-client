import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const app = process.cwd();
const html = readFileSync(join(app, 'build', 'index.html'), 'utf8');
const meta = html.match(/<meta http-equiv="content-security-policy" content="([^"]+)"/);
if (!meta) {
	throw new Error('auth build has no hashed content-security-policy to promote to a header');
}
const policy = meta[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const required = [
	"default-src 'none'",
	"object-src 'none'",
	"base-uri 'none'",
	"connect-src 'self'",
	"require-trusted-types-for 'script'"
];
for (const directive of required) {
	if (!policy.includes(directive)) {
		throw new Error(`auth content-security-policy lost ${directive}`);
	}
}
if (/'unsafe-eval'|'strict-dynamic'|\*/.test(policy.replace(/'wasm-unsafe-eval'/g, ''))) {
	throw new Error('auth content-security-policy admits eval or a wildcard source');
}
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].length;
const hashes = (policy.match(/'sha256-[A-Za-z0-9+/=]+'/g) ?? []).length;
if (hashes < inline) {
	throw new Error(`auth index.html has ${inline} inline scripts but the policy hashes ${hashes}`);
}

const header = `${policy}; frame-ancestors 'none'`;
if (header.includes('"')) {
	throw new Error('auth content-security-policy contains a double quote');
}
mkdirSync(join(app, 'build-meta'), { recursive: true });
writeFileSync(
	join(app, 'build-meta', 'csp.caddy'),
	`header Content-Security-Policy "${header}"\n`
);
console.log(`auth-headers: ${hashes} script hashes, ${header.length} bytes`);
