import { getMailboxCounts } from '$lib/api/messages';
import type { MailboxCounts } from '$lib/api/types';

class UnreadStore {
	#counts = $state(new Map<string, MailboxCounts>());
	#pending = new Map<string, Promise<void>>();

	countsFor(accountId: string): MailboxCounts | null {
		return this.#counts.get(accountId) ?? null;
	}

	set(accountId: string, counts: MailboxCounts): void {
		const map = new Map(this.#counts);
		map.set(accountId, counts);
		this.#counts = map;
	}

	async refresh(accountId: string): Promise<void> {
		const pending = this.#pending.get(accountId);
		if (pending) return pending;
		const run = (async () => {
			try {
				const counts = await getMailboxCounts(accountId);
				this.set(accountId, counts);
			} catch {
			} finally {
				this.#pending.delete(accountId);
			}
		})();
		this.#pending.set(accountId, run);
		return run;
	}

	forget(accountId: string): void {
		if (!this.#counts.has(accountId)) return;
		const map = new Map(this.#counts);
		map.delete(accountId);
		this.#counts = map;
		this.#pending.delete(accountId);
	}

	clear(): void {
		this.#counts = new Map();
		this.#pending.clear();
	}
}

export const unread = new UnreadStore();
