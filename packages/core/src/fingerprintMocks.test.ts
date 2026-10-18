// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = import.meta.dirname;

const PATTERNS: [string, RegExp][] = [
	['grouped hex', /\b[0-9A-Fa-f]{4}(?: [0-9A-Fa-f]{4}){3,}\b/],
	['hex run', /['"`][0-9A-Fa-f]{32,}['"`]/],
	['verified-at stub', /\b\d{1,2} [A-Z][a-z]{2} \d{4} · v\d+\b/]
];

function sources(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name === 'fixtures' || name === 'node_modules') continue;
			out.push(...sources(path));
		} else if (/\.(svelte|ts)$/.test(name) && !/\.test\.ts$/.test(name)) {
			out.push(path);
		}
	}
	return out;
}

describe('key and fingerprint mocks', () => {
	it('keeps fingerprint-looking literals out of shipped sources', () => {
		const hits: string[] = [];
		for (const file of sources(ROOT)) {
			const lines = readFileSync(file, 'utf8').split('\n');
			lines.forEach((line, i) => {
				for (const [kind, re] of PATTERNS) {
					if (re.test(line)) hits.push(`${relative(ROOT, file)}:${i + 1} ${kind}`);
				}
			});
		}
		expect(hits).toEqual([]);
	});
});
