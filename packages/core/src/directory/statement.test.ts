// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseStatementBytes, StatementParseError } from './statement';
import { rotationVectors, vectorBytes } from './fixtures/rotation';

describe('strict directory statement parse', () => {
	it('uses the shared schema', () => {
		expect(rotationVectors.schema).toBe('thelemail-rotation-vectors/v1');
	});

	for (const v of rotationVectors.statements.filter((s) => s.valid)) {
		it(`accepts ${v.name}`, () => {
			const stmt = parseStatementBytes(vectorBytes(v.raw));
			const e = v.expected!;
			expect(stmt.accountId).toBe(e.accountId);
			expect(stmt.address).toBe(e.address);
			expect(stmt.issuedAt).toBe(e.issuedAt);
			expect(stmt.keyAlgorithm).toBe(e.keyAlgorithm);
			expect(stmt.keyFingerprint).toBe(e.keyFingerprint);
			expect(stmt.signingKeyFingerprint).toBe(e.signingKeyFingerprint);
			expect(stmt.version).toBe(e.version);
			expect(
				stmt.keyTransitions.map((t) => ({
					previousKeyFingerprint: t.previousKeyFingerprint,
					retiredAt: t.retiredAt,
					signature: btoa(String.fromCharCode(...t.signature))
				}))
			).toEqual(e.keyTransitions ?? []);
			for (const t of stmt.keyTransitions) {
				expect(t.retiredAtMillis).toBe(Date.parse(t.retiredAt));
			}
		});
	}

	for (const v of rotationVectors.statements.filter((s) => !s.valid)) {
		it(`rejects ${v.name} as ${v.error}`, () => {
			let err: unknown;
			try {
				parseStatementBytes(vectorBytes(v.raw));
			} catch (e) {
				err = e;
			}
			expect(err).toBeInstanceOf(StatementParseError);
			expect((err as StatementParseError).kind).toBe(v.error);
		});
	}

	it('rejects an empty statement', () => {
		expect(() => parseStatementBytes(new Uint8Array())).toThrow(StatementParseError);
	});

	it('reports the field that failed', () => {
		const raw = new TextEncoder().encode('{"accountId":"a","address":"b"}');
		let err: StatementParseError | undefined;
		try {
			parseStatementBytes(raw);
		} catch (e) {
			err = e as StatementParseError;
		}
		expect(err?.kind).toBe('invalid_field');
		expect(err?.field).toBe('keyAlgorithm');
	});
});
