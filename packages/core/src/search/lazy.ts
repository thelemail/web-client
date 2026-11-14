import { keystore } from '$core/keystore/keystore-client';
import type { Broadcast } from '$core/keystore/protocol';
import { platform } from '$platform';
import type { SearchClient } from './runtime/client';
import { searchRecords } from './runtime/records';

const IDLE_TIMEOUT_MS = 5000;
const IDLE_FALLBACK_MS = 3000;

interface Running {
	accountId: string;
	client: Promise<SearchClient>;
}

function supported(): boolean {
	return import.meta.env.PUBLIC_PRIVATE_SEARCH === '1' && !platform.mirror && !platform.keystoreChannel;
}

function whenIdle(work: () => void): () => void {
	if (typeof requestIdleCallback === 'function') {
		const handle = requestIdleCallback(work, { timeout: IDLE_TIMEOUT_MS });
		return () => cancelIdleCallback(handle);
	}
	const timer = setTimeout(work, IDLE_FALLBACK_MS);
	return () => clearTimeout(timer);
}

class SearchRuntime {
	#accountId: string | null = null;
	#running: Running | null = null;

	attach(accountId: string): () => void {
		if (!supported()) return () => {};
		this.#accountId = accountId;
		const cancelIdle = whenIdle(() => {
			void searchRecords.get(accountId).then(
				(record) => {
					if (record?.hasIndex && this.#accountId === accountId) this.#ensure(accountId);
				},
				() => undefined
			);
		});
		const unsubscribe = keystore.subscribeAccount(accountId, (b) => this.#onKeystore(accountId, b));
		return () => {
			cancelIdle();
			unsubscribe();
			if (this.#accountId === accountId) this.#accountId = null;
			void this.#stop(accountId, false);
		};
	}

	focus(): void {
		if (this.#accountId && supported()) this.#ensure(this.#accountId);
	}

	client(): Promise<SearchClient> | null {
		return this.#running?.accountId === this.#accountId ? (this.#running?.client ?? null) : null;
	}

	#ensure(accountId: string): void {
		if (this.#running?.accountId === accountId) return;
		const client = import('./runtime/start').then((m) => m.startSearch(accountId));
		const running: Running = { accountId, client };
		this.#running = running;
		client.catch(() => {
			if (this.#running === running) this.#running = null;
		});
	}

	async #stop(accountId: string, wipe: boolean): Promise<void> {
		const running = this.#running;
		if (running?.accountId === accountId) {
			this.#running = null;
			const client = await running.client.catch(() => null);
			if (client) {
				await client.shutdown({ wipe });
				return;
			}
		}
		if (!wipe) return;
		const record = await searchRecords.get(accountId).catch(() => null);
		if (record) await import('./runtime/start').then((m) => m.wipeSearch(accountId));
	}

	#onKeystore(accountId: string, b: Broadcast): void {
		if (b.type === 'locked') void this.#stop(accountId, false);
		else if (b.type === 'cleared' || b.type === 'clearedAll') void this.#stop(accountId, true);
		else if (b.type === 'vaultChanged') void this.#running?.client.then((c) => c.retry()).catch(() => undefined);
	}
}

export const searchRuntime = new SearchRuntime();
