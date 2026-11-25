import type { AccountSlotRecord } from '$core/keystore/idb';

export type SlotMap = Map<string, number>;

export const MAX_SLOT = 99;

const ACCOUNT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function parseSlot(raw: string | null | undefined): number | null {
	if (!raw || !/^\d{1,2}$/.test(raw)) return null;
	const n = Number(raw);
	return n <= MAX_SLOT ? n : null;
}

export function slotsOf(records: readonly Pick<AccountSlotRecord, 'accountId' | 'slot'>[]): SlotMap {
	return new Map(records.map((r) => [r.accountId, r.slot]));
}

export function encodeSlots(map: SlotMap): string {
	return [...map]
		.sort((a, b) => a[1] - b[1])
		.map(([id, n]) => `${id}.${n}`)
		.join(',');
}

export function decodeSlots(raw: string | null | undefined): SlotMap | null {
	if (!raw) return null;
	const map: SlotMap = new Map();
	const used = new Set<number>();
	for (const pair of raw.split(',')) {
		const dot = pair.lastIndexOf('.');
		const id = pair.slice(0, dot).toLowerCase();
		const n = parseSlot(pair.slice(dot + 1));
		if (dot < 0 || !ACCOUNT_ID.test(id) || n === null || map.has(id) || used.has(n)) return null;
		map.set(id, n);
		used.add(n);
	}
	return map;
}

export function lowestFree(taken: Iterable<number>): number {
	const used = new Set(taken);
	let n = 0;
	while (used.has(n)) n++;
	return n;
}

export function pickSlot(used: Iterable<number>, prefer: number | null | undefined, reserved: Iterable<number> = []): number {
	const inUse = new Set(used);
	if (prefer !== null && prefer !== undefined && !inUse.has(prefer)) return prefer;
	return lowestFree([...inUse, ...reserved]);
}

export function alignRecords(records: readonly AccountSlotRecord[], target: SlotMap): AccountSlotRecord[] {
	const reserved = new Set(target.values());
	const known = records.filter((r) => target.has(r.accountId));
	const unknown = records.filter((r) => !target.has(r.accountId)).sort((a, b) => a.slot - b.slot);
	const placed: AccountSlotRecord[] = known.map((r) => ({ ...r, slot: target.get(r.accountId)! }));
	const used = new Set(placed.map((r) => r.slot));
	for (const r of unknown) {
		const slot = reserved.has(r.slot) || used.has(r.slot) ? lowestFree([...reserved, ...used]) : r.slot;
		used.add(slot);
		placed.push(slot === r.slot ? r : { ...r, slot });
	}
	return placed.sort((a, b) => a.slot - b.slot);
}
