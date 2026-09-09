import { SvelteMap } from 'svelte/reactivity';
import { fetchBimiLogo } from '$lib/api/bimi';

class BimiStore {
	#logos = new SvelteMap<string, string | null>();
	#inflight = new Map<string, Promise<void>>();
	#accountId: string | null = null;
	#gen = 0;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.#gen++;
		for (const url of this.#logos.values()) {
			if (url) URL.revokeObjectURL(url);
		}
		this.#logos.clear();
		this.#inflight.clear();
	}

	logoUrl(domain: string | undefined): string | null {
		if (!domain) return null;
		const key = domain.trim().toLowerCase();
		if (!key) return null;
		if (this.#logos.has(key)) return this.#logos.get(key) ?? null;
		if (!this.#inflight.has(key)) {
			this.#inflight.set(key, this.#load(key));
		}
		return null;
	}

	async #load(key: string): Promise<void> {
		const gen = this.#gen;
		try {
			const b64 = await fetchBimiLogo(key);
			if (gen !== this.#gen) return;
			this.#logos.set(key, b64 === null ? null : this.#toObjectUrl(b64));
		} catch {
			return;
		} finally {
			if (gen === this.#gen) this.#inflight.delete(key);
		}
	}

	#toObjectUrl(b64: string): string | null {
		try {
			const s = atob(b64);
			const bytes = new Uint8Array(s.length);
			for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
			return URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }));
		} catch {
			return null;
		}
	}
}

export const bimi = new BimiStore();
