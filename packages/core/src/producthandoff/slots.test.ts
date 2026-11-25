import { describe, expect, it } from 'vitest';
import type { AccountSlotRecord } from '$core/keystore/idb';
import { alignRecords, decodeSlots, encodeSlots, layoutWith, parseSlot, pickSlot, slotsOf, withSlots } from './slots';

const A = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const B = '8e1f4c2a-7b3d-4a5e-b6c9-0d2e3f4a5b6c';
const C = '0f6c9a1e-2b3d-4c5e-8f7a-9b0c1d2e3f40';
const D = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function rec(accountId: string, slot: number): AccountSlotRecord {
	return { accountId, slot, email: `${slot}@thelemail.test`, addedAt: 1, lastActiveAt: 1 };
}

function layout(records: AccountSlotRecord[]): Record<string, number> {
	return Object.fromEntries(records.map((r) => [r.accountId, r.slot]));
}

describe('account index map', () => {
	it('round-trips through a fragment value', () => {
		const map = slotsOf([rec(B, 2), rec(A, 0)]);
		const raw = encodeSlots(map);
		expect(raw).toBe(`${A}.0,${B}.2`);
		expect(decodeSlots(new URLSearchParams(`slots=${raw}`).get('slots'))).toEqual(map);
	});

	it('rejects anything that is not a clean map', () => {
		for (const raw of [`${A}.0,${A}.1`, `${A}.0,${B}.0`, `${A}.x`, `${A}.100`, 'nope.1', `${A}`, '']) {
			expect(decodeSlots(raw), raw).toBeNull();
		}
		expect(parseSlot('07')).toBe(7);
		expect(parseSlot('-1')).toBeNull();
		expect(parseSlot('100')).toBeNull();
	});

	it('prefers the asked index, otherwise the lowest one nobody holds or reserves', () => {
		expect(pickSlot([0, 1], 4)).toBe(4);
		expect(pickSlot([0, 1], 1)).toBe(2);
		expect(pickSlot([0, 1], null, [2, 3])).toBe(4);
		expect(pickSlot([], undefined)).toBe(0);
	});
});

describe('lining accounts up with the account origin', () => {
	it('swaps two accounts into the indexes auth gave them', () => {
		const next = alignRecords([rec(A, 0), rec(B, 1)], slotsOf([rec(B, 0), rec(A, 1)]));
		expect(layout(next)).toEqual({ [A]: 1, [B]: 0 });
	});

	it('moves an account auth does not know out of an index auth uses', () => {
		const next = alignRecords([rec(A, 0), rec(C, 1)], slotsOf([rec(A, 1), rec(D, 0)]));
		expect(layout(next)).toEqual({ [A]: 1, [C]: 2 });
	});

	it('keeps an unknown account where it is when that index is free', () => {
		const next = alignRecords([rec(A, 3), rec(C, 5)], slotsOf([rec(A, 0)]));
		expect(layout(next)).toEqual({ [A]: 0, [C]: 5 });
	});

	it('puts a new account from auth at its index in a crowded browser', () => {
		const mail = [rec(A, 0), rec(B, 1), rec(C, 2), rec(D, 3)];
		const fresh = '9b1ab926-830e-4e56-b6c1-8d922866ab2a';
		const next = alignRecords([...mail, rec(fresh, 0)], slotsOf([rec(fresh, 0), rec(B, 1)]));
		expect(layout(next)).toEqual({ [fresh]: 0, [B]: 1, [A]: 2, [C]: 3, [D]: 4 });
		expect(new Set(next.map((r) => r.slot)).size).toBe(next.length);
	});

	it('keeps every other field of a moved record', () => {
		const [moved] = alignRecords([{ ...rec(A, 0), sessionId: 's', sessionOrigin: 'host' }], slotsOf([rec(A, 4)]));
		expect(moved).toEqual({ ...rec(A, 4), email: '0@thelemail.test', sessionId: 's', sessionOrigin: 'host' });
	});
});

describe('the callback from the account origin', () => {
	it('adds the index and the map to the callback fragment', () => {
		const url = withSlots('https://app.thelemail.test/auth/callback#code=c&state=s', 2, slotsOf([rec(A, 2), rec(B, 0)]));
		const p = new URLSearchParams(new URL(url).hash.slice(1));
		expect(p.get('code')).toBe('c');
		expect(p.get('slot')).toBe('2');
		expect(decodeSlots(p.get('slots'))).toEqual(slotsOf([rec(B, 0), rec(A, 2)]));
	});

	it('trusts the index over a map that disagrees and keeps older callbacks working', () => {
		expect(layoutWith(A, 1, slotsOf([rec(A, 0), rec(B, 1)]))).toEqual(new Map([[A, 1]]));
		expect(layoutWith(A, 0, null)).toEqual(new Map([[A, 0]]));
		expect(layoutWith(A, null, slotsOf([rec(A, 0)]))).toBeNull();
	});
});
