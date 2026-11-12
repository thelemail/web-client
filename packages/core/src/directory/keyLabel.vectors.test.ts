// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as openpgp from 'openpgp';
import vectors from '../interop/vectors/key-labels.json';
import { keyLabel, labelMatchesKey, MISLABELLED_V4_CUTOFF } from './keyLabel';

describe('key labels agree with trust', () => {
	it('uses the same cutoff', () => {
		expect(MISLABELLED_V4_CUTOFF).toBe(Date.parse(vectors.cutoff));
	});

	for (const c of vectors.cases) {
		it(`labels ${c.name}`, async () => {
			const key = await openpgp.readKey({ armoredKey: c.publicKeyArmored });
			expect(key.getFingerprint()).toBe(c.fingerprint);
			expect(keyLabel(key)).toBe(c.label);
			for (const m of c.matches) {
				expect(labelMatchesKey(m.label, key, m.issuedAt), `${m.label} at ${m.issuedAt}`).toBe(m.matches);
			}
		});
	}
});
