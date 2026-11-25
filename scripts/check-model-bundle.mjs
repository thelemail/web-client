import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const app = process.cwd();
const build = join(app, 'build');
const manifest = JSON.parse(readFileSync(join(import.meta.dirname, 'model-manifest.json'), 'utf8'));
const MODELS = join(build, '_app', 'immutable', 'models');
const FORBIDDEN_MODULES = [/onnxruntime-node/, /(^|\/)sharp(\/|$)/, /@img\//, /ort\.(?:all|webgpu|webgl|jspi)/, /jsep/, /(^|\/)(?:node:)?fs(?:\/promises)?$/];
const REQUIRED_MODULES = [/onnxruntime-web\/dist\/ort\.wasm\.bundle\.min\.mjs$/, /@huggingface\/tokenizers\//, /packages\/core\/src\/search\/model\/model\.worker\.ts$/];
const ALLOWED_REQUIRES = new Set(['node:os']);

const problems = [];
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

const want = new Map();
for (const f of manifest.files) want.set(`${f.sha256}${f.path.slice(f.path.lastIndexOf('.'))}`, f);
for (const l of manifest.licenses) want.set(`${l.sha256}.txt`, l);
const present = existsSync(MODELS) ? readdirSync(MODELS) : [];
for (const [name, entry] of want) {
	const path = join(MODELS, name);
	if (!present.includes(name)) problems.push(`missing model asset ${entry.path}`);
	else if (sha256(path) !== entry.sha256 || (entry.size !== undefined && statSync(path).size !== entry.size)) problems.push(`model asset ${entry.path} does not match the manifest`);
}
for (const name of present) if (!want.has(name)) problems.push(`unexpected file in models: ${name}`);

const runtime = manifest.files.find((f) => f.id === 'runtime');
for (const path of files(build)) {
	if (path.startsWith(MODELS) || !path.endsWith('.wasm')) continue;
	if (statSync(path).size === runtime.size && sha256(path) === runtime.sha256) problems.push(`second copy of the onnx runtime at ${path.slice(app.length + 1)}`);
}

const inventory = join(app, 'build-meta', 'model-worker.json');
if (!existsSync(inventory)) problems.push('no model worker module inventory');
else {
	const { chunks, modules } = JSON.parse(readFileSync(inventory, 'utf8'));
	if (chunks.length !== 1) problems.push(`expected one model worker, found ${chunks.length}`);
	for (const id of modules) {
		if (FORBIDDEN_MODULES.some((re) => re.test(id))) problems.push(`forbidden module in the model worker: ${id}`);
	}
	for (const re of REQUIRED_MODULES) if (!modules.some((id) => re.test(id))) problems.push(`model worker lacks ${re}`);
	for (const chunk of chunks) {
		const text = readFileSync(join(build, '_app', 'immutable', 'workers', chunk.replace(/^.*workers\//, '')), 'utf8');
		if (/\bimportScripts\s*\(/.test(text)) problems.push(`${chunk} calls importScripts`);
		if (/\bnew\s+(?:Shared)?Worker\s*\(\s*new\s+URL/.test(text)) problems.push(`${chunk} spawns a bundled worker`);
		if (text.includes('ort-wasm-simd-threaded.wasm",import.meta.url')) problems.push(`${chunk} can still fetch the onnx runtime on its own`);
		for (const m of text.matchAll(/\(`((?:node:)?[a-z_/]+)`\)\.|require\(["'`]([^"'`]+)["'`]\)/g)) {
			const name = m[1] ?? m[2];
			if (/^(?:node:)?(?:fs|os|path|child_process|worker_threads|url|crypto)(?:\/.*)?$/.test(name) && !ALLOWED_REQUIRES.has(name)) problems.push(`${chunk} requires ${name}`);
		}
	}
}

if (problems.length) {
	for (const p of problems) console.error(`check-model-bundle: ${p}`);
	process.exit(1);
}
console.log(`check-model-bundle: ${want.size} pinned assets, one model worker, no node runtime`);
