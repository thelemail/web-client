import { SvelteMap } from 'svelte/reactivity';
import { resolveAvatars } from '$lib/api/accounts';
import {
	cachePersonAvatar,
	hydratePersonAvatars,
	releasePersonAvatars
} from '$lib/avatarCache.svelte';

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
		if (this.#accountId) releasePersonAvatars(this.#accountId);
		this.#accountId = accountId;
		this.#gen++;
		this.#entries.clear();
		this.#queued.clear();
		this.#inflight.clear();
		if (accountId) void this.#hydrate(accountId, this.#gen);
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

	async #hydrate(accountId: string, gen: number): Promise<void> {
		const cached = await hydratePersonAvatars(accountId);
		if (gen !== this.#gen) return;
		for (const [address, rec] of cached) {
			if (this.#entries.has(address)) continue;
			this.#entries.set(address, { url: rec.url, at: rec.updatedAt });
		}
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
		const accountId = this.#accountId;
		if (!accountId) return;
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
				for (const key of chunk) this.#inflight.delete(key);
				continue;
			}
			if (gen !== this.#gen) return;
			const at = Date.now();
			await Promise.all(
				chunk.map(async (key) => {
					const source = found.get(key);
					const url = source ? await cachePersonAvatar(accountId, key, source) : null;
					if (gen !== this.#gen) return;
					this.#entries.set(key, { url, at });
					this.#inflight.delete(key);
				})
			);
		}
	}
}

export const personAvatars = new PersonAvatarStore();
