import { describe, expect, it } from 'vitest';
import type { CustodyJournal } from './journal';
import { advance, CUSTODY_STATES, exchangeExpired, isProductCustody, isSettled, readable, reached, rewind } from './journal';

function journal(state: CustodyJournal['state']): CustodyJournal {
	return {
		accountId: 'acc',
		schema: 1,
		migrationId: 'op-1',
		state,
		target: { kind: 'candidate', digest: 'ZGlnZXN0' },
		exchange: null,
		sessionId: null,
		startedAt: 1,
		updatedAt: 1,
		failure: { code: 'network', state, at: 1 }
	};
}

describe('custody journal', () => {
	it('moves one boundary at a time, in order', () => {
		let j = journal('prepared');
		for (const next of CUSTODY_STATES.slice(1)) {
			j = advance(j, next, 5);
			expect(j.state).toBe(next);
			expect(j.updatedAt).toBe(5);
			expect(j.failure).toBeNull();
		}
		expect(() => advance(j, 'complete')).toThrow();
	});

	it('refuses to skip or go back', () => {
		expect(() => advance(journal('prepared'), 'mail-committed')).toThrow();
		expect(() => advance(journal('mail-committed'), 'mail-staged')).toThrow();
		expect(() => advance(journal('mail-staged'), 'mail-staged')).toThrow();
	});

	it('treats the vault as mail-only from the local commit on', () => {
		expect(isProductCustody(null)).toBe(false);
		expect(isProductCustody(journal('prepared'))).toBe(false);
		expect(isProductCustody(journal('mail-staged'))).toBe(false);
		for (const s of ['mail-committed', 'legacy-retired-local', 'auth-ready', 'complete'] as const) {
			expect(isProductCustody(journal(s))).toBe(true);
		}
		expect(isSettled(journal('legacy-retired-local'))).toBe(false);
		expect(isSettled(journal('auth-ready'))).toBe(true);
		expect(reached(journal('mail-staged'), 'prepared')).toBe(true);
	});

	it('restarts only before the local commit', () => {
		const staged = { ...journal('mail-staged'), exchange: { id: 'm', ticket: 't', verifier: 'v', expiresAt: 10, step: 'staged' as const, durable: true }, sessionId: 's' };
		const again = rewind(staged, 'op-2', { kind: 'committed', digest: 'bmV3' }, 9);
		expect(again).toMatchObject({ migrationId: 'op-2', state: 'prepared', exchange: null, sessionId: null, target: { kind: 'committed', digest: 'bmV3' } });
		expect(() => rewind(journal('mail-committed'), 'op-2', staged.target)).toThrow();
	});

	it('expires an exchange unless its commit is in flight', () => {
		const base = { id: 'm', ticket: 't', verifier: 'v', expiresAt: 100, durable: false };
		expect(exchangeExpired(null, 200)).toBe(false);
		expect(exchangeExpired({ ...base, step: 'installed' }, 99)).toBe(false);
		expect(exchangeExpired({ ...base, step: 'installed' }, 100)).toBe(true);
		expect(exchangeExpired({ ...base, step: 'staged' }, 200)).toBe(true);
		expect(exchangeExpired({ ...base, step: 'committing' }, 200)).toBe(false);
	});

	it('does not read a journal written by a newer build', () => {
		expect(readable(null)).toBe(true);
		expect(readable(journal('prepared'))).toBe(true);
		expect(readable({ ...journal('prepared'), schema: 2 })).toBe(false);
	});
});
