// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('.', import.meta.url));

function sources(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === 'legacy' || name === 'testdata' ? [] : sources(path);
		return /\.(ts|svelte)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
	});
}

const FORBIDDEN = [
	'$core/mail/sendDispatch',
	"$core/mail/send'",
	'$core/mail/decrypt',
	'$core/directory/memberKey',
	'signDetached',
	'decryptPreview',
	'createAliasKey',
	'requireConfirmedOwnKey'
];

describe('calendar code outside legacy/', () => {
	const files = sources(root);

	it('finds the calendar sources', () => {
		expect(files.length).toBeGreaterThan(20);
	});

	it('never reaches mail dispatch, the mail key or caller-chosen signatures', () => {
		const hits = files.flatMap((f) => {
			const text = readFileSync(f, 'utf8');
			return FORBIDDEN.filter((needle) => text.includes(needle)).map((needle) => `${relative(root, f)}: ${needle}`);
		});
		expect(hits).toEqual([]);
	});

	it('loads legacy modules only on demand', () => {
		const hits = files.filter((f) => /^\s*import[^;]*from\s+['"][./]*legacy\//m.test(readFileSync(f, 'utf8')));
		expect(hits.map((f) => relative(root, f))).toEqual([]);
	});
});
