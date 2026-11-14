import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ChunkNode } from './chunk-graph.ts';
import { ALLOWANCE, grown, initialClosure, type Sizes } from './initial-size.ts';

const app = join(import.meta.dirname, '..', 'apps', 'mail');
const baselinePath = join(import.meta.dirname, 'initial-size.json');

function gzipped(files: readonly string[]): number {
	return files.reduce((sum, file) => sum + gzipSync(readFileSync(join(app, 'build', file)), { level: 9 }).length, 0);
}

const chunks: ChunkNode[] = JSON.parse(readFileSync(join(app, 'build-meta', 'chunks.json'), 'utf8'));
const closure = initialClosure(chunks);

if (closure.forbidden.length) {
	for (const id of closure.forbidden) console.error(`check-initial-size: ${id} is in the initial bundle`);
	process.exit(1);
}

const measured: Sizes = { js: gzipped(closure.js), css: gzipped(closure.css) };

if (process.argv.includes('--update')) {
	writeFileSync(baselinePath, JSON.stringify(measured, null, '\t') + '\n');
	console.log(`check-initial-size: baseline set to js ${measured.js}, css ${measured.css}`);
	process.exit(0);
}

const baseline: Sizes = JSON.parse(readFileSync(baselinePath, 'utf8'));
const over = grown(measured, baseline);
for (const kind of over) {
	console.error(`check-initial-size: initial ${kind} is ${measured[kind]} bytes gzip, baseline ${baseline[kind]}, allowance ${ALLOWANCE}`);
}
if (over.length) process.exit(1);
console.log(
	`check-initial-size: js ${measured.js} (baseline ${baseline.js}), css ${measured.css} (baseline ${baseline.css}), ${closure.js.length} chunks`
);
