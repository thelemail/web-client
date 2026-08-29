import { browser } from '$app/environment';
import { listMyAliasKeys } from '$lib/api/aliases';
import { keystore } from '$lib/keystore/keystore-client';

const REFRESH_INTERVAL_MS = 30_000;

function b64ToText(b64: string): string {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return new TextDecoder().decode(bytes);
}

function b64ToHex(b64: string): string {
	const bin = atob(b64);
	let out = '';
	for (let i = 0; i < bin.length; i++) {
		out += bin.charCodeAt(i).toString(16).padStart(2, '0');
	}
	return out;
}

class AliasKeysStore {
	loaded = $state(false);
	error = $state<string | null>(null);
	#accountId: string | null = null;
	#ready: Promise<void> | null = null;
	#lastRefresh = 0;
	#unsubscribe: (() => void) | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.clear();
		this.#watch();
	}

	#watch(): void {
		if (!browser || this.#unsubscribe) return;
		this.#unsubscribe = keystore.subscribe((b) => {
			if (b.type === 'locked' || b.type === 'cleared' || b.type === 'clearedAll') {
				this.clear();
				return;
			}
			if (b.type === 'vaultChanged' && b.accountId === this.#accountId) {
				void this.load(b.accountId);
			}
		});
	}

	// Resolves even on failure: a mailbox must never wedge waiting for keys it
	// may not need.
	ready(accountId: string): Promise<void> {
		if (this.#accountId !== accountId) {
			this.#accountId = accountId;
			this.#ready = null;
		}
		this.#ready ??= this.#fetch(accountId);
		return this.#ready;
	}

	load(accountId: string): Promise<void> {
		this.#ready = this.#fetch(accountId);
		return this.#ready;
	}

	async refresh(accountId: string): Promise<void> {
		const now = Date.now();
		if (now - this.#lastRefresh < REFRESH_INTERVAL_MS) return;
		await this.load(accountId);
	}

	async #fetch(accountId: string): Promise<void> {
		if (!browser) return;
		this.#lastRefresh = Date.now();
		try {
			const { keys } = await listMyAliasKeys();
			if (this.#accountId !== accountId) return;
			if (!keys.length) {
				this.loaded = true;
				return;
			}
			const res = await keystore.loadAliasKeys({
				accountId,
				grants: keys.map((k) => ({
					aliasId: k.aliasId,
					addressId: k.addressId,
					email: k.email,
					name: k.name,
					keyVersion: k.keyVersion,
					aliasKeyFingerprintHex: b64ToHex(k.aliasKeyFingerprint),
					wrappedPrivateKeyArmored: b64ToText(k.wrappedPrivateKey),
					isCurrent: k.isCurrent
				}))
			});
			if (this.#accountId !== accountId) return;
			this.loaded = res.ok;
			this.error = res.ok ? null : 'vault is locked';
		} catch (err) {
			if (this.#accountId !== accountId) return;
			this.error = err instanceof Error ? err.message : 'failed to load alias keys';
			this.loaded = true;
		}
	}

	clear(): void {
		this.loaded = false;
		this.error = null;
		this.#ready = null;
		this.#lastRefresh = 0;
	}
}

export const aliasKeys = new AliasKeysStore();
