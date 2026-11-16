import { afterBoot } from '$core/async/idle';
import { keystore } from '$core/keystore/keystore-client';
import type { Broadcast } from '$core/keystore/protocol';
import { platform } from '$platform';
import type { SearchClient } from './runtime/client';
import { searchRecords } from './runtime/records';

interface Running {
	accountId: string;
	client: Promise<SearchClient>;
}

function supported(): boolean {
	return import.meta.env.PUBLIC_PRIVATE_SEARCH === '1' && !platform.mirror && !platform.keystoreChannel;
}

const CHANGE_COALESCE_MS = 750;

class SearchRuntime {
	#accountId: string | null = null;
	#running: Running | null = null;
	#pendingChange: ReturnType<typeof setTimeout> | undefined;

	attach(accountId: string): () => void {
		if (!supported()) return () => {};
		this.#accountId = accountId;
		const cancelIdle = afterBoot(() => {
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

	changed(accountId: string): void {
		if (this.#running?.accountId !== accountId || this.#pendingChange) return;
		this.#pendingChange = setTimeout(() => {
			this.#pendingChange = undefined;
			this.#tell(accountId, 'sync', null);
		}, CHANGE_COALESCE_MS);
	}

	#tell(accountId: string, job: string, message: unknown): void {
		const running = this.#running;
		if (running?.accountId !== accountId) return;
		void running.client.then((c) => c.tell(job, message)).catch(() => undefined);
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
		else if (b.type === 'aliasKeysChanged' || b.type === 'accountKeysChanged') this.#tell(accountId, 'describe', { retryLocked: true });
	}
}

export const searchRuntime = new SearchRuntime();
