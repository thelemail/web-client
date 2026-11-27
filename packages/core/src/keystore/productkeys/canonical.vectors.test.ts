// @vitest-environment node
import { describe, expect, it } from 'vitest';
import raw from '../../interop/vectors/jcs.json?raw';
import { canonicalize, MAX_SAFE, parseJson, utf8 } from './canonical';
import { b64decode, sha256 } from './encoding';

const DIGEST = '81f5a809f378049c9f5a9598328d8d336be44c04e22ade9a67dfaf8aab4bd9ab';

interface Case {
	name: string;
	input: string;
	output?: string;
	canonical: boolean;
	error?: string;
}

const file = JSON.parse(raw) as { maxSafeInteger: number; maxDepth: number; cases: Case[] };
const decoder = new TextDecoder('utf-8', { fatal: true });

function canonical(input: Uint8Array): string {
	return canonicalize(parseJson(decoder.decode(input)));
}

function hex(b: Uint8Array): string {
	return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

describe('jcs vectors', () => {
	it('pins the file digest and bounds', async () => {
		expect(hex(await sha256(utf8(raw)))).toBe(DIGEST);
		expect(file.maxSafeInteger).toBe(MAX_SAFE);
	});

	for (const c of file.cases) {
		it(c.error ? `rejects ${c.name}` : `canonicalizes ${c.name}`, () => {
			const input = b64decode(c.input);
			if (c.error) {
				expect(() => canonical(input)).toThrow();
				return;
			}
			const out = canonical(input);
			expect(out).toBe(c.output);
			expect(canonical(utf8(out))).toBe(out);
			expect(decoder.decode(input) === out).toBe(c.canonical);
		});
	}
});
