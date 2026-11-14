import { describe, expect, it } from 'vitest';
import { RESERVE_CAP, admit, isQuotaError, requestPersistence, reserveFor } from './quota';

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

describe('reserveFor', () => {
	it('is ten percent of a small quota', () => {
		expect(reserveFor(1000 * MIB)).toBe(100 * MIB);
	});

	it('is capped at 256 MiB', () => {
		expect(reserveFor(100 * GIB)).toBe(RESERVE_CAP);
	});
});

describe('admit', () => {
	const store = (quota: number, usage: number) => ({ estimate: async () => ({ quota, usage }) });

	it('admits a batch that leaves the reserve free', async () => {
		expect(await admit(4 * MIB, store(10 * GIB, 1 * GIB))).toEqual({ ok: true });
	});

	it('refuses a batch that would eat into the reserve', async () => {
		expect(await admit(4 * MIB, store(10 * GIB, 10 * GIB - 258 * MIB))).toEqual({ ok: false, reason: 'quota' });
	});

	it('admits when the browser reports nothing', async () => {
		expect(await admit(4 * MIB, {})).toEqual({ ok: true });
		expect(await admit(4 * MIB, { estimate: async () => ({}) })).toEqual({ ok: true });
		expect(
			await admit(4 * MIB, {
				estimate: async () => {
					throw new Error('denied');
				}
			})
		).toEqual({ ok: true });
	});
});

describe('requestPersistence', () => {
	it('does not ask again when storage is already persistent', async () => {
		let asked = 0;
		const ok = await requestPersistence({
			persisted: async () => true,
			persist: async () => {
				asked++;
				return true;
			}
		});
		expect(ok).toBe(true);
		expect(asked).toBe(0);
	});

	it('reports a refusal', async () => {
		expect(await requestPersistence({ persisted: async () => false, persist: async () => false })).toBe(false);
		expect(await requestPersistence(undefined)).toBe(false);
	});
});

describe('isQuotaError', () => {
	it('recognises browser and SQLite full errors', () => {
		expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
		expect(isQuotaError(Object.assign(new Error('x'), { resultCode: 13 }))).toBe(true);
		expect(isQuotaError(Object.assign(new Error('x'), { resultCode: 13 | (1 << 8) }))).toBe(true);
		expect(isQuotaError(new Error('SQLITE_FULL: database or disk is full'))).toBe(true);
	});

	it('leaves other errors alone', () => {
		expect(isQuotaError(new Error('SQLITE_CORRUPT'))).toBe(false);
		expect(isQuotaError(Object.assign(new Error('x'), { resultCode: 11 }))).toBe(false);
		expect(isQuotaError(null)).toBe(false);
	});
});
