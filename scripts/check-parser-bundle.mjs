import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const app = process.cwd();
const build = join(app, 'build');

const allowedCore = [
	/^packages\/core\/src\/search\/extract\/(?!.*\.test\.ts$)(?!files\/fixtures\.ts$)[\w/.-]+\.ts$/,
	/^packages\/core\/src\/search\/parser\/protocol\.ts$/,
	/^packages\/core\/src\/search\/sqlite\/types\.ts$/,
	/^packages\/core\/src\/mail\/render\/textDecoderPolyfill\.ts$/
];
const forbiddenStrings = ['/v1/', 'thelemail-keystore', 'thelemail-search', 'indexedDB', 'document.cookie', 'sendBeacon', 'serviceWorker.register'];
const ABSOLUTE = String.raw`(?:[a-z][a-z0-9+.-]*:)?\/\/`;
const LOADS = [
	new RegExp(String.raw`\bfrom\s*["'](${ABSOLUTE}[^"']+)["']`, 'g'),
	new RegExp(String.raw`\bimport\s*\(\s*["'](${ABSOLUTE}[^"']+)["']`, 'g'),
	new RegExp(String.raw`\bimportScripts\s*\(`, 'g'),
	new RegExp(String.raw`<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*["']?${ABSOLUTE}`, 'gi')
];
const PDFJS_CDN_WRAPPER = '`await import("${e}");`';
const LITERAL_IMPORT = /\bimportScripts\s*\(|\bimport\s*\(\s*(?:\/\*(?:[^*]|\*(?!\/))*\*\/\s*)*["'`](?!\$\{)|^\s*import[\s{*'"]|\bfrom\s*["']\.{0,2}\//m;

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

const problems = [];

const modules = [...new Set(readFileSync(join(app, 'build-meta', 'modules.txt'), 'utf8').split('\n').filter(Boolean))];
for (const id of modules) {
	if (!id.startsWith('packages/core/')) continue;
	if (!allowedCore.some((re) => re.test(id))) problems.push(`core module outside the extraction boundary: ${id}`);
}

const workerDir = join(build, '_app', 'immutable', 'workers');
const workers = readdirSync(workerDir).filter((name) => name.endsWith('.js'));
if (workers.length !== 1) problems.push(`expected exactly one worker, found ${workers.length}`);
for (const name of workers) {
	const text = readFileSync(join(workerDir, name), 'utf8').replaceAll(PDFJS_CDN_WRAPPER, '');
	if (LITERAL_IMPORT.test(text)) problems.push(`worker ${name} loads code at runtime`);
	if (/\bnew\s+(?:Shared)?Worker\s*\(\s*new\s+URL/.test(text)) problems.push(`worker ${name} spawns a bundled worker`);
}

for (const file of files(build)) {
	if (!/\.(js|html|css)$/.test(file)) continue;
	const text = readFileSync(file, 'utf8');
	const rel = file.slice(app.length + 1);
	for (const pattern of LOADS) {
		for (const match of text.replaceAll(PDFJS_CDN_WRAPPER, '').matchAll(pattern)) problems.push(`${rel}: remote load ${match[0].slice(0, 80)}`);
	}
	for (const marker of forbiddenStrings) {
		if (text.includes(marker)) problems.push(`${rel}: forbidden marker ${marker}`);
	}
}

if (problems.length) {
	for (const p of problems) console.error(`check-parser-bundle: ${p}`);
	process.exit(1);
}
console.log(`check-parser-bundle: ${modules.length} modules, one locked worker, no remote loads`);
