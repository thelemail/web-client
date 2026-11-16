import { afterBoot } from '$core/async/idle';
import { keystore } from '$core/keystore/keystore-client';
import type { Broadcast } from '$core/keystore/protocol';
import { platform } from '$platform';
import type { SearchClient } from './runtime/client';
import { defaultPrefs, searchPrefs, searchRecords, type Consent, type SearchPrefs } from './runtime/records';

interface Running {
	accountId: string;
	consent: Consent;
	client: Promise<SearchClient>;
}

const LEGACY_DB = 'thelemail-search';
const PREFS_CHANNEL = 'thelemail-search-prefs';
const CHANGE_COALESCE_MS = 750;

export function searchSupported(): boolean {
	return !platform.mirror && !platform.keystoreChannel;
}

class SearchRuntime {
	#accountId: string | null = null;
	#running: Running | null = null;
	#pendingChange: ReturnType<typeof setTimeout> | undefined;
	#prefs: SearchPrefs | null = null;
	#listeners = new Set<(prefs: SearchPrefs | null) => void>();
	#channel: BroadcastChannel | null = null;
	#legacyDropped = false;

	attach(accountId: string): () => void {
		if (!searchSupported()) return () => {};
		this.#accountId = accountId;
		this.#listen();
		const cancelIdle = afterBoot(() => {
			this.#dropLegacy();
			void this.#loadPrefs(accountId).then((prefs) => {
				if (prefs?.consent === 'saved' && this.#accountId === accountId) this.#ensure(accountId);
			});
		});
		const unsubscribe = keystore.subscribeAccount(accountId, (b) => this.#onKeystore(accountId, b));
		return () => {
			cancelIdle();
			unsubscribe();
			if (this.#accountId === accountId) {
				this.#accountId = null;
				this.#setPrefs(null);
			}
			void this.#stop(accountId, false);
		};
	}

	get prefs(): SearchPrefs | null {
		return this.#prefs;
	}

	subscribePrefs(listener: (prefs: SearchPrefs | null) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#prefs);
		return () => this.#listeners.delete(listener);
	}

	focus(): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId || !searchSupported()) return Promise.resolve();
		return this.#loadPrefs(accountId).then(() => {
			if (this.#accountId === accountId) this.#ensure(accountId);
		});
	}

	changed(accountId: string): void {
		if (this.#running?.accountId !== accountId || this.#pendingChange) return;
		this.#pendingChange = setTimeout(() => {
			this.#pendingChange = undefined;
			this.#tell(accountId, 'sync', null);
		}, CHANGE_COALESCE_MS);
	}

	client(): Promise<SearchClient> | null {
		return this.#running?.accountId === this.#accountId ? (this.#running?.client ?? null) : null;
	}

	async enable(): Promise<void> {
		await this.#update({ consent: 'saved' });
		await this.#restart(false);
	}

	async decline(): Promise<void> {
		await this.#update({ consent: 'declined' });
	}

	async clear(): Promise<void> {
		await this.#update({ consent: 'declined', history: false });
		await this.#restart(true);
	}

	async rebuild(): Promise<void> {
		await this.#update({ consent: 'saved' });
		await this.#restart(true);
	}

	async setPaused(paused: boolean): Promise<void> {
		await this.#update({ paused });
		await this.#running?.client.then((c) => c.pause(paused)).catch(() => undefined);
	}

	async setHistory(history: boolean): Promise<void> {
		await this.#update({ history });
		if (!history) await this.#running?.client.then((c) => c.forget()).catch(() => undefined);
	}

	async retryFailed(): Promise<void> {
		await this.#running?.client.then((c) => c.retryFailed()).catch(() => undefined);
	}

	#dropLegacy(): void {
		if (this.#legacyDropped || typeof indexedDB === 'undefined') return;
		this.#legacyDropped = true;
		try {
			indexedDB.deleteDatabase(LEGACY_DB);
		} catch {
			this.#legacyDropped = false;
		}
	}

	#listen(): void {
		if (this.#channel || typeof BroadcastChannel === 'undefined') return;
		this.#channel = new BroadcastChannel(PREFS_CHANNEL);
		this.#channel.onmessage = (e: MessageEvent<{ accountId: string; restart: boolean }>) => {
			const accountId = this.#accountId;
			if (!accountId || e.data?.accountId !== accountId) return;
			void this.#loadPrefs(accountId, true).then((prefs) => {
				if (!prefs || this.#accountId !== accountId) return;
				const running = this.#running;
				const want: Consent = prefs.consent === 'saved' ? 'saved' : 'declined';
				if (running?.accountId === accountId && (e.data.restart || running.consent !== want)) void this.#restart(false, false);
			});
		};
	}

	async #loadPrefs(accountId: string, fresh = false): Promise<SearchPrefs | null> {
		if (!fresh && this.#prefs?.accountId === accountId) return this.#prefs;
		const prefs = await searchPrefs.get(accountId).catch(() => defaultPrefs(accountId));
		if (this.#accountId !== accountId) return null;
		this.#setPrefs(prefs);
		return prefs;
	}

	#setPrefs(prefs: SearchPrefs | null): void {
		this.#prefs = prefs;
		for (const l of this.#listeners) l(prefs);
	}

	async #update(change: Partial<Omit<SearchPrefs, 'accountId'>>): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId) return;
		const current = (await this.#loadPrefs(accountId)) ?? defaultPrefs(accountId);
		const next = { ...current, ...change };
		await searchPrefs.put(next);
		if (this.#accountId !== accountId) return;
		this.#setPrefs(next);
		this.#channel?.postMessage({ accountId, restart: false });
	}

	async #restart(wipe: boolean, announce = true): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId) return;
		const running = this.#running?.accountId === accountId;
		await this.#stop(accountId, wipe);
		if (announce && wipe) this.#channel?.postMessage({ accountId, restart: true });
		if (this.#accountId === accountId && (running || this.#prefs?.consent === 'saved')) this.#ensure(accountId);
	}

	#tell(accountId: string, job: string, message: unknown): void {
		const running = this.#running;
		if (running?.accountId !== accountId) return;
		void running.client.then((c) => c.tell(job, message)).catch(() => undefined);
	}

	#ensure(accountId: string): void {
		if (this.#running?.accountId === accountId) return;
		const consent: Consent = this.#prefs?.accountId === accountId && this.#prefs.consent === 'saved' ? 'saved' : 'declined';
		const client = import('./runtime/start').then((m) => m.startSearch(accountId, consent));
		const running: Running = { accountId, consent, client };
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
				if (wipe && client.mode === 'preview') await this.#wipeStored(accountId);
				return;
			}
		}
		if (wipe) await this.#wipeStored(accountId);
	}

	async #wipeStored(accountId: string): Promise<void> {
		const record = await searchRecords.get(accountId).catch(() => null);
		if (record) await import('./runtime/start').then((m) => m.wipeSearch(accountId));
	}

	#onKeystore(accountId: string, b: Broadcast): void {
		if (b.type === 'locked') void this.#stop(accountId, false);
		else if (b.type === 'cleared' || b.type === 'clearedAll') {
			void this.#stop(accountId, true).then(() => searchPrefs.delete(accountId).catch(() => undefined));
		} else if (b.type === 'vaultChanged') void this.#running?.client.then((c) => c.retry()).catch(() => undefined);
		else if (b.type === 'aliasKeysChanged' || b.type === 'accountKeysChanged') this.#tell(accountId, 'describe', { retryLocked: true });
	}
}

export const searchRuntime = new SearchRuntime();
