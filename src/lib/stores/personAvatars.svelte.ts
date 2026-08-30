import { SvelteMap } from 'svelte/reactivity';
import { resolveAvatars } from '$lib/api/accounts';

const BATCH_LIMIT = 100;
const REFRESH_AFTER_MS = 50 * 60 * 1000;

interface Entry {
	url: string | null;
	at: number;
}

class PersonAvatarStore {
	#entries = new SvelteMap<string, Entry>();
	#queued = new Set<string>();
	#inflight = new Set<string>();
	#flushing = false;
	#accountId: string | null = null;
	#gen = 0;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.#gen++;
		this.#entries.clear();
		this.#queued.clear();
		this.#inflight.clear();
	}

	avatarUrl(address: string | undefined): string | null {
		if (!address || !this.#accountId) return null;
		const key = address.trim().toLowerCase();
		if (!key) return null;
		const hit = this.#entries.get(key);
		if (hit && Date.now() - hit.at < REFRESH_AFTER_MS) return hit.url;
		this.#enqueue(key);
		return hit?.url ?? null;
	}

	#enqueue(key: string): void {
		if (this.#queued.has(key) || this.#inflight.has(key)) return;
		this.#queued.add(key);
		if (this.#flushing) return;
		this.#flushing = true;
		queueMicrotask(() => void this.#flush());
	}

	async #flush(): Promise<void> {
		const gen = this.#gen;
		const pending = [...this.#queued];
		this.#queued.clear();
		this.#flushing = false;
		for (const key of pending) this.#inflight.add(key);
		for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
			const chunk = pending.slice(i, i + BATCH_LIMIT);
			let found: Map<string, string>;
			try {
				const res = await resolveAvatars(chunk);
				found = new Map(res.avatars.map((a) => [a.address.trim().toLowerCase(), a.avatarUrl]));
			} catch {
				continue;
			} finally {
				for (const key of chunk) this.#inflight.delete(key);
			}
			if (gen !== this.#gen) return;
			const at = Date.now();
			for (const key of chunk) {
				this.#entries.set(key, { url: found.get(key) ?? null, at });
			}
		}
	}
}

export const personAvatars = new PersonAvatarStore();
