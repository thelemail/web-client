import { describe, expect, it } from 'vitest';
import { BUSY_CANON_VERSION, canonicalise } from './busycanon';
import vectors from './testdata/busysign-vectors.json';

interface Vector {
	name: string;
	statement: {
		calendarId: string;
		itemId: string;
		privacy: string;
		rev: number;
		signerAccountId: string;
		windows: [string, string][];
	};
	canonical: string;
}

const decoder = new TextDecoder();

describe('busy window canonicalisation', () => {
	it('pins the canonical version the vectors were written for', () => {
		expect(BUSY_CANON_VERSION).toBe(1);
	});

	for (const v of vectors as Vector[]) {
		it(`matches the shared vector: ${v.name}`, () => {
			const bytes = canonicalise({
				...v.statement,
				windows: v.statement.windows.map(([startsAt, endsAt]) => ({ startsAt, endsAt }))
			});
			expect(decoder.decode(bytes)).toBe(v.canonical);
		});
	}

	it('sorts windows so a reordered list signs identically', () => {
		const forward = canonicalise({
			calendarId: 'c',
			itemId: 'i',
			privacy: 'busy',
			rev: 3,
			signerAccountId: 'a',
			windows: [
				{ startsAt: '2026-01-01T10:00:00.000Z', endsAt: '2026-01-01T11:00:00.000Z' },
				{ startsAt: '2026-01-01T09:00:00.000Z', endsAt: '2026-01-01T09:30:00.000Z' }
			]
		});
		const reversed = canonicalise({
			calendarId: 'c',
			itemId: 'i',
			privacy: 'busy',
			rev: 3,
			signerAccountId: 'a',
			windows: [
				{ startsAt: '2026-01-01T09:00:00.000Z', endsAt: '2026-01-01T09:30:00.000Z' },
				{ startsAt: '2026-01-01T10:00:00.000Z', endsAt: '2026-01-01T11:00:00.000Z' }
			]
		});
		expect(decoder.decode(forward)).toBe(decoder.decode(reversed));
	});

	it('lowercases identifiers so casing cannot fork the signature', () => {
		const upper = canonicalise({
			calendarId: 'AB',
			itemId: 'CD',
			privacy: 'busy',
			rev: 1,
			signerAccountId: 'EF',
			windows: []
		});
		expect(decoder.decode(upper)).toContain('"calendarId":"ab"');
		expect(decoder.decode(upper)).toContain('"signerAccountId":"ef"');
	});

	it('rejects a window that is not a valid instant', () => {
		expect(() =>
			canonicalise({
				calendarId: 'c',
				itemId: 'i',
				privacy: 'busy',
				rev: 1,
				signerAccountId: 'a',
				windows: [{ startsAt: 'not-a-date', endsAt: '2026-01-01T00:00:00.000Z' }]
			})
		).toThrow();
	});
});
