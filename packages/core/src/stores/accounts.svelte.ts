import { browser } from '$app/env';
import {
	clearAllAccountSlots,
	deleteAccountSlot,
	getAllAccountSlots,
	putAccountSlot,
	replaceAccountSlots,
	type AccountSlotRecord
} from '$core/keystore/idb';
import { alignRecords, pickSlot, type SlotMap } from '$core/producthandoff/slots';
import { syncSessionHint } from './session-hint';

const CHANNEL_NAME = 'thelemail:accounts';
const MSG_REHYDRATE = 'rehydrate';

class AccountsStore {
	list = $state<AccountSlotRecord[]>([]);
	#channel: BroadcastChannel | null = null;
	#loaded = false;
	#sessions = new Map<string, string>();

	constructor() {
		if (browser) {
			try {
				this.#channel = new BroadcastChannel(CHANNEL_NAME);
				this.#channel.onmessage = (ev) => {
					if (ev.data === MSG_REHYDRATE) {
						void this.#reload();
					}
				};
			} catch {
				this.#channel = null;
			}
		}
	}

	async load(): Promise<void> {
		if (!browser || this.#loaded) return;
		this.#loaded = true;
		await this.#reload();
	}

	async #reload(): Promise<void> {
		const all = await getAllAccountSlots();
		all.sort((a, b) => a.slot - b.slot);
		this.list = all;
		syncSessionHint(all.length > 0);
	}

	async refresh(): Promise<void> {
		if (!browser) return;
		this.#loaded = true;
		await this.#reload();
	}

	bySlot(slot: number): AccountSlotRecord | null {
		return this.list.find((r) => r.slot === slot) ?? null;
	}

	byId(accountId: string): AccountSlotRecord | null {
		return this.list.find((r) => r.accountId === accountId) ?? null;
	}

	allocateSlot(prefer?: number | null, reserved?: Iterable<number>): number {
		return pickSlot(this.list.map((r) => r.slot), prefer, reserved);
	}

	async alignSlots(target: SlotMap, incoming?: AccountSlotRecord): Promise<void> {
		const all = await getAllAccountSlots();
		const rest = all.filter((r) => r.accountId !== incoming?.accountId);
		const records = incoming ? [...rest, this.#withSession(incoming, all)] : rest;
		const next = alignRecords(records, target);
		const before = new Map(all.map((r) => [r.accountId, r.slot]));
		const unchanged = !incoming && next.every((r) => before.get(r.accountId) === r.slot);
		if (!unchanged) await replaceAccountSlots(next);
		await this.#reload();
		if (!unchanged) this.#broadcast();
	}

	#withSession(record: AccountSlotRecord, all: AccountSlotRecord[]): AccountSlotRecord {
		const sessionId = this.#sessions.get(record.accountId) ?? record.sessionId ?? all.find((r) => r.accountId === record.accountId)?.sessionId;
		this.#sessions.delete(record.accountId);
		return sessionId ? { ...record, sessionId } : record;
	}

	get lastActiveSlot(): number | null {
		if (this.list.length === 0) return null;
		let best = this.list[0];
		for (const r of this.list) {
			if (r.lastActiveAt > best.lastActiveAt) best = r;
		}
		return best.slot;
	}

	async upsert(record: AccountSlotRecord): Promise<void> {
		await putAccountSlot(this.#withSession(record, this.list));
		await this.#reload();
		this.#broadcast();
	}

	async touch(accountId: string): Promise<void> {
		const all = await getAllAccountSlots();
		const rec = all.find((r) => r.accountId === accountId);
		if (!rec) {
			await this.#reload();
			return;
		}
		const updated: AccountSlotRecord = { ...rec, lastActiveAt: Date.now() };
		await putAccountSlot(updated);
		await this.#reload();
		this.#broadcast();
	}

	async setEmail(accountId: string, email: string): Promise<void> {
		const all = await getAllAccountSlots();
		const rec = all.find((r) => r.accountId === accountId);
		if (!rec || rec.email === email) return;
		await putAccountSlot({ ...rec, email });
		await this.#reload();
		this.#broadcast();
	}

	async setSessionId(accountId: string, sessionId: string): Promise<void> {
		const all = await getAllAccountSlots();
		const rec = all.find((r) => r.accountId === accountId);
		if (!rec) {
			this.#sessions.set(accountId, sessionId);
			return;
		}
		if (rec.sessionId === sessionId) return;
		await putAccountSlot({ ...rec, sessionId });
		await this.#reload();
		this.#broadcast();
	}

	async remove(accountId: string): Promise<void> {
		await deleteAccountSlot(accountId);
		await this.#reload();
		this.#broadcast();
	}

	async clear(): Promise<void> {
		await clearAllAccountSlots();
		this.list = [];
		syncSessionHint(false);
		this.#broadcast();
	}

	#broadcast(): void {
		try {
			this.#channel?.postMessage(MSG_REHYDRATE);
		} catch {
		}
	}
}

export const accounts = new AccountsStore();
