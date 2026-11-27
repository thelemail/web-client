// @vitest-environment node
import { describe, expect, it } from 'vitest';
import raw from '../interop/vectors/profile-registry.json?raw';
import { COUNTERS, LEGACY_IMPORT_PREFIX, LIMITS, MAX_COUNTER, PROFILE_IDS, PROFILES, SECRET_WRAP } from '../interop/generated/profiles';
import { utf8 } from './productkeys/canonical';
import { sha256 } from './productkeys/encoding';
import { canCreate, canDecrypt, canVerify, checkCounter, convertsTo, CounterError, isLegacyImport, isLegacyImportFormat, nextCounter } from './registry';

const DIGEST = '2a4bfb5422d65e6d87885cb26a9d664588281aeb2327b60c808909ee638fc63c';

const vectorFiles = import.meta.glob('../interop/vectors/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

function hex(b: Uint8Array): string {
	return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const file = JSON.parse(raw);

describe('profile registry', () => {
	it('matches the vector file', async () => {
		expect(hex(await sha256(utf8(raw)))).toBe(DIGEST);
		expect(file.maxCounter).toBe(MAX_COUNTER);
		expect(file.counters).toEqual([...COUNTERS]);
		expect(file.limits).toEqual({ ...LIMITS });
		expect(file.secretWrap).toEqual(JSON.parse(JSON.stringify(SECRET_WRAP)));
		expect(file.profiles.map((p: { id: string }) => p.id)).toEqual([...PROFILE_IDS]);
		for (const { vectorDigest: _d, ...p } of file.profiles) expect(JSON.parse(JSON.stringify(PROFILES[p.id as keyof typeof PROFILES]))).toEqual(p);
	});

	it('pins every vector file the registry names', async () => {
		for (const [name, digest] of Object.entries(file.vectorDigests as Record<string, string>)) {
			const text = vectorFiles[`../interop/vectors/${name}`];
			expect(text, name).toBeDefined();
			expect(hex(await sha256(utf8(text))), name).toBe(digest);
		}
	});

	it('is frozen', () => {
		expect(Object.isFrozen(PROFILES)).toBe(true);
		expect(Object.isFrozen(PROFILES['mail-classic-v1'].keyUses)).toBe(true);
		expect(() => (PROFILES['mail-classic-v1'].keyUses as string[]).push('wrap')).toThrow();
	});

	it('gates permissions by status', () => {
		expect(canCreate('mail-classic-v1')).toBe(true);
		expect(canCreate('mail-pq-v1') || canDecrypt('mail-pq-v1') || canVerify('mail-pq-v1')).toBe(false);
		expect(canCreate('legacy-import-amk-wrap-v1')).toBe(false);
		expect(canDecrypt('legacy-import-amk-wrap-v1')).toBe(true);
		expect(canCreate('secret-wrap-v3')).toBe(false);
		expect(isLegacyImport('legacy-import-srp-v1')).toBe(true);
		expect(isLegacyImport('legacy-import-unknown-v1')).toBe(false);
		expect(isLegacyImportFormat('legacy-import-openpgp-rsa-v4')).toBe(true);
		expect(isLegacyImportFormat(LEGACY_IMPORT_PREFIX)).toBe(false);
		expect(convertsTo('legacy-import-amk-wrap-v1', 'secret-wrap-v2')).toBe(true);
		expect(convertsTo('secret-wrap-v2', 'legacy-import-amk-wrap-v1')).toBe(false);
	});

	it('bounds counters and fails closed on overflow', () => {
		expect(checkCounter(0)).toBe(0);
		expect(checkCounter(MAX_COUNTER)).toBe(MAX_COUNTER);
		expect(nextCounter(41)).toBe(42);
		for (const v of [-1, MAX_COUNTER + 1, 1.5, Number.NaN]) expect(() => checkCounter(v)).toThrow(CounterError);
		expect(() => nextCounter(MAX_COUNTER)).toThrow(CounterError);
	});
});
