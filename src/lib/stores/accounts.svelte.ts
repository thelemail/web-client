import { browser } from '$app/environment';
import {
	clearAllAccountSlots,
	deleteAccountSlot,
	getAllAccountSlots,
	putAccountSlot,
	type AccountSlotRecord
} from '$lib/keystore/idb';
import { syncSessionHint } from './session-hint';

const CHANNEL_NAME = 'thelemail:accounts';
const MSG_REHYDRATE = 'rehydrate';

class AccountsStore {
	list = $state<AccountSlotRecord[]>([]);
	#channel: BroadcastChannel | null = null;
	#loaded = false;

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

	bySlot(slot: number): AccountSlotRecord | null {
		return this.list.find((r) => r.slot === slot) ?? null;
	}

	byId(accountId: string): AccountSlotRecord | null {
		return this.list.find((r) => r.accountId === accountId) ?? null;
	}

	allocateSlot(): number {
		const used = new Set(this.list.map((r) => r.slot));
		let n = 0;
		while (used.has(n)) n++;
		return n;
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
		await putAccountSlot(record);
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
