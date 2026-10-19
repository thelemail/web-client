import { describe, expect, it } from 'vitest';
import { delegationStatus } from './status';

const now = Date.parse('2026-09-21T12:00:00Z');

describe('delegationStatus', () => {
	it('is active before notAfter', () => {
		expect(delegationStatus({ notAfter: '2026-09-21T12:00:01Z' }, now)).toBe('active');
	});

	it('is expired once notAfter is reached', () => {
		expect(delegationStatus({ notAfter: '2026-09-21T12:00:00Z' }, now)).toBe('expired');
		expect(delegationStatus({ notAfter: '2026-01-01T00:00:00Z' }, now)).toBe('expired');
	});

	it('reports revoked over expired', () => {
		expect(
			delegationStatus({ notAfter: '2026-01-01T00:00:00Z', revokedAt: '2025-12-01T00:00:00Z' }, now)
		).toBe('revoked');
		expect(
			delegationStatus({ notAfter: '2027-01-01T00:00:00Z', revokedAt: '2026-09-01T00:00:00Z' }, now)
		).toBe('revoked');
	});
});
