// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
	keyTransitionPayload,
	KeyTransitionError,
	verifyKeyTransition
} from './key-transition';
import { parseStatementBytes } from './statement';
import { the168, vectorBytes, vectorKey } from './fixtures/the168';

describe('key transition endorsements', () => {
	for (const v of the168.transitions) {
		it(`${v.valid ? 'accepts' : 'rejects'} ${v.name}${v.error ? ` as ${v.error}` : ''}`, async () => {
			const payload = keyTransitionPayload(v.accountId, v.newKeyFingerprint, v.previousKeyFingerprint);
			expect(new TextDecoder().decode(payload)).toBe(v.payload);
			const run = verifyKeyTransition({
				accountId: v.accountId,
				newKeyFingerprint: v.newKeyFingerprint,
				previousKeyFingerprint: v.previousKeyFingerprint,
				signature: vectorBytes(v.signature),
				previousPublicKeyArmored: v.previousPublicKeyArmored
			});
			if (v.valid) {
				await expect(run).resolves.toBeUndefined();
				return;
			}
			const err = await run.then(
				() => null,
				(e: unknown) => e
			);
			expect(err).toBeInstanceOf(KeyTransitionError);
			expect((err as KeyTransitionError).code).toBe(v.error);
		});
	}

	for (const v of the168.statements.filter((s) => s.valid && s.expected?.keyTransitions)) {
		it(`verifies every endorsement in ${v.name}`, async () => {
			const stmt = parseStatementBytes(vectorBytes(v.raw));
			expect(stmt.keyTransitions.length).toBeGreaterThan(0);
			for (const t of stmt.keyTransitions) {
				await verifyKeyTransition({
					accountId: stmt.accountId,
					newKeyFingerprint: stmt.keyFingerprint,
					previousKeyFingerprint: t.previousKeyFingerprint,
					signature: t.signature,
					previousPublicKeyArmored: vectorKey(t.previousKeyFingerprint).publicKeyArmored
				});
			}
		});
	}

	it('escapes line and paragraph separators like the platform encoder', () => {
		const payload = new TextDecoder().decode(keyTransitionPayload('a b ', 'AB', 'CD'));
		expect(payload).toBe(
			'{"accountId":"a\\u2028b\\u2029","newKeyFingerprint":"ab","previousKeyFingerprint":"cd","type":"thelemail-key-transition/v1"}'
		);
	});
});
