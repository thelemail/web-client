import { browser } from '$app/environment';
import { listMyKeys } from '$core/api/me';
import { keystore } from '$core/keystore/keystore-client';
import type { AccountKeySummary } from '$core/keystore/protocol';
import { bytesToHex } from '$core/keys/encode';
import { isProductVault } from '$core/products';

export interface CurrentAccountKey {
	fingerprintHex: string;
	keyVersion: number;
	publicKeyArmored: string;
}

class AccountKeysStore {
	current = $state<CurrentAccountKey | null>(null);
	history = $state<AccountKeySummary[]>([]);
	authScheme = $state<'srp_v1' | 'opaque_v1' | null>(null);
	error = $state<string | null>(null);
	#accountId: string | null = null;
	#ready = new Map<string, Promise<void>>();
	#unsubscribe: (() => void) | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.current = null;
		this.history = [];
		this.error = null;
		this.#watch();
	}

	#watch(): void {
		if (!browser || this.#unsubscribe) return;
		this.#unsubscribe = keystore.subscribe((b) => {
			if (b.type === 'clearedAll') {
				this.#ready.clear();
				this.current = null;
				this.history = [];
				return;
			}
			if (b.type === 'locked' || b.type === 'cleared') {
				this.#ready.delete(b.accountId);
				if (b.accountId === this.#accountId) {
					this.current = null;
					this.history = [];
				}
				return;
			}
			if (b.type === 'vaultChanged') {
				void this.load(b.accountId);
				return;
			}
			if (b.type === 'accountKeysChanged' && b.accountId === this.#accountId) {
				void this.#refreshLocal(b.accountId);
			}
		});
	}

	ready(accountId: string): Promise<void> {
		let pending = this.#ready.get(accountId);
		if (!pending) {
			pending = this.#fetch(accountId);
			this.#ready.set(accountId, pending);
		}
		return pending;
	}

	load(accountId: string): Promise<void> {
		const pending = this.#fetch(accountId);
		this.#ready.set(accountId, pending);
		return pending;
	}

	noteServerKey(accountId: string, keyFingerprint: string | undefined, keyVersion: number | undefined): void {
		if (!browser || !keyFingerprint) return;
		const mine = accountId === this.#accountId ? this.current : null;
		if (mine && mine.fingerprintHex === keyFingerprint.toLowerCase() && mine.keyVersion === keyVersion) return;
		void (async () => {
			const r = await keystore.getPublicKey({ accountId }).catch(() => null);
			if (!r?.ok) return;
			if (bytesToHex(r.fingerprint) === keyFingerprint.toLowerCase() && r.keyVersion === keyVersion) return;
			await this.load(accountId);
		})();
	}

	async #fetch(accountId: string): Promise<void> {
		if (!browser) return;
		try {
			const status = await keystore.status();
			const account = status.accounts.find((a) => a.accountId === accountId);
			if (!account?.unlocked) return;
			if (account.authScheme === 'opaque_v1' && !isProductVault) {
				const { keys } = await listMyKeys(accountId);
				const res = await keystore.loadAccountKeys({
					accountId,
					keys: keys.map((k) => ({
						keyVersion: k.keyVersion,
						fingerprintHex: k.keyFingerprint.toLowerCase(),
						encryptedPrivateKeyArmored: k.encryptedPrivateKey,
						isCurrent: k.isCurrent
					}))
				});
				if (!res.ok && res.code === 'locked') return;
				if (accountId === this.#accountId) {
					this.error = res.ok && res.failed.length === 0 ? null : 'history_incomplete';
				}
			}
			await this.#refreshLocal(accountId);
		} catch (err) {
			if (accountId === this.#accountId) {
				this.error = err instanceof Error ? err.message : 'account_keys_unavailable';
			}
			await this.#refreshLocal(accountId);
		}
	}

	async #refreshLocal(accountId: string): Promise<void> {
		const [pub, list, status] = await Promise.all([
			keystore.getPublicKey({ accountId }).catch(() => null),
			keystore.listAccountKeys({ accountId }).catch(() => null),
			keystore.status().catch(() => null)
		]);
		if (accountId !== this.#accountId) return;
		this.authScheme = status?.accounts.find((a) => a.accountId === accountId)?.authScheme ?? null;
		if (!pub?.ok) {
			this.current = null;
			this.history = [];
			return;
		}
		this.current = {
			fingerprintHex: bytesToHex(pub.fingerprint),
			keyVersion: pub.keyVersion ?? 1,
			publicKeyArmored: pub.publicKeyArmored
		};
		this.history = list?.ok ? list.keys.filter((k) => !k.isCurrent) : [];
	}
}

export const accountKeys = new AccountKeysStore();
