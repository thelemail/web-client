import { browser } from '$app/environment';
import { listMyKeys } from '$core/api/me';
import { ApiCallError, type AccountKeyListResponse } from '$core/api/types';
import { keystore } from '$core/keystore/keystore-client';
import type { AccountKeySummary } from '$core/keystore/protocol';
import { bytesToHex } from '$core/keys/encode';
import { isProductVault } from '$core/products';
import { decodeStrictBase64 } from '$core/directory/statement';
import { DirectoryVerificationError, type DirectoryVerificationCode } from '$core/directory/errors';

export interface CurrentAccountKey {
	fingerprintHex: string;
	keyVersion: number;
	publicKeyArmored: string;
}

export type OwnKeyVerification = 'unknown' | 'verified' | 'pending' | 'unverified';

const PENDING_CODES: ReadonlySet<DirectoryVerificationCode> = new Set(['tlog_proof_missing', 'tlog_pending']);
const RECHECK_BASE_MS = 30_000;
const RECHECK_MAX_MS = 10 * 60_000;
const RECHECK_LIMIT = 8;

class AccountKeysStore {
	current = $state<CurrentAccountKey | null>(null);
	history = $state<AccountKeySummary[]>([]);
	authScheme = $state<'srp_v1' | 'opaque_v1' | null>(null);
	error = $state<'history_incomplete' | 'account_keys_unavailable' | null>(null);
	verification = $state<OwnKeyVerification>('unknown');
	#accountId: string | null = null;
	#ready = new Map<string, Promise<void>>();
	#unsubscribe: (() => void) | null = null;
	#verified = new Map<string, OwnKeyVerification>();
	#primary = new Map<string, string>();
	#rechecks = new Map<string, { timer: ReturnType<typeof setTimeout>; attempt: number }>();

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.current = null;
		this.history = [];
		this.error = null;
		this.verification = (accountId && this.#verified.get(accountId)) || 'unknown';
		this.#watch();
	}

	isUnverified(accountId: string): boolean {
		return this.#verified.get(accountId) === 'unverified';
	}

	#watch(): void {
		if (!browser || this.#unsubscribe) return;
		this.#unsubscribe = keystore.subscribe((b) => {
			if (b.type === 'clearedAll') {
				this.#ready.clear();
				for (const id of [...this.#verified.keys()]) this.#forget(id);
				this.current = null;
				this.history = [];
				return;
			}
			if (b.type === 'locked' || b.type === 'cleared') {
				this.#ready.delete(b.accountId);
				this.#forget(b.accountId);
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

	noteServerKey(
		accountId: string,
		keyFingerprint: string | undefined,
		keyVersion: number | undefined,
		primaryEmail?: string
	): void {
		if (primaryEmail) this.#primary.set(accountId, primaryEmail.trim().toLowerCase());
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

	async #fetch(accountId: string, again = false): Promise<void> {
		if (!browser) return;
		try {
			const status = await keystore.status();
			const account = status.accounts.find((a) => a.accountId === accountId);
			if (!account?.unlocked) return;
			const list =
				account.authScheme === 'opaque_v1' && !isProductVault ? await this.#serverKeys(accountId) : null;
			if (list) {
				const res = await keystore.loadAccountKeys({
					accountId,
					currentVersion: list.currentVersion,
					keys: list.keys.map((k) => ({
						keyVersion: k.keyVersion,
						fingerprintHex: k.keyFingerprint.toLowerCase(),
						encryptedPrivateKeyArmored: k.encryptedPrivateKey,
						isCurrent: k.isCurrent,
						transitions: (k.transitions ?? []).map((t) => ({
							previousKeyFingerprintHex: t.previousKeyFingerprint.toLowerCase(),
							signature: decodeStrictBase64(t.signature) ?? new Uint8Array(0)
						}))
					}))
				});
				if (!res.ok && res.code === 'locked') return;
				if (accountId === this.#accountId) {
					this.error = res.ok && res.failed.length === 0 ? null : 'history_incomplete';
				}
				await this.#refreshLocal(accountId);
				const address = this.#primary.get(accountId) ?? account.email;
				if (!(await this.#checkDirectory(accountId, address, again)) && !again) {
					await this.#fetch(accountId, true);
				}
				return;
			}
			await this.#refreshLocal(accountId);
		} catch (err) {
			if (accountId === this.#accountId) {
				this.error = 'account_keys_unavailable';
			}
			await this.#refreshLocal(accountId);
		}
	}

	async #serverKeys(accountId: string): Promise<AccountKeyListResponse | null> {
		try {
			return await listMyKeys(accountId);
		} catch (err) {
			if (err instanceof ApiCallError && err.status === 404) return null;
			throw err;
		}
	}

	async #checkDirectory(accountId: string, address: string, final: boolean): Promise<boolean> {
		const outcome = await this.#ownStatement(accountId, address.trim().toLowerCase());
		if (outcome === null) return true;
		if (outcome === 'unverified' && !final) return false;
		this.#set(accountId, outcome);
		if (outcome === 'pending') this.#scheduleRecheck(accountId, address);
		else this.#cancelRecheck(accountId);
		return outcome !== 'unverified';
	}

	async #ownStatement(accountId: string, address: string): Promise<OwnKeyVerification | null> {
		const pub = await keystore.getPublicKey({ accountId }).catch(() => null);
		if (!pub?.ok) return null;
		const local = bytesToHex(pub.fingerprint);
		try {
			const [{ lookupDirectory }, { verifyDirectoryLookup }] = await Promise.all([
				import('$core/directory/lookup'),
				import('$core/directory/verify')
			]);
			const lookup = await lookupDirectory(address);
			const { statement, tlog } = await verifyDirectoryLookup(lookup, address, { pin: false });
			if (statement.accountId !== accountId || statement.keyFingerprint !== local) return 'unverified';
			if (tlog.state === 'failed' && PENDING_CODES.has(tlog.code)) return 'pending';
			return 'verified';
		} catch (err) {
			if (err instanceof DirectoryVerificationError) {
				return PENDING_CODES.has(err.code) ? 'pending' : 'unverified';
			}
			return 'pending';
		}
	}

	#set(accountId: string, outcome: OwnKeyVerification): void {
		const previous = this.#verified.get(accountId);
		if (outcome === 'pending' && previous === 'unverified') return;
		this.#verified.set(accountId, outcome);
		if (accountId === this.#accountId) this.verification = outcome;
	}

	#scheduleRecheck(accountId: string, address: string): void {
		const attempt = (this.#rechecks.get(accountId)?.attempt ?? 0) + 1;
		this.#cancelRecheck(accountId);
		if (attempt > RECHECK_LIMIT) return;
		const delay = Math.min(RECHECK_BASE_MS * 2 ** (attempt - 1), RECHECK_MAX_MS);
		const timer = setTimeout(() => {
			void this.#checkDirectory(accountId, address, false).then((ok) => {
				if (!ok) void this.load(accountId);
			});
		}, delay);
		this.#rechecks.set(accountId, { timer, attempt });
	}

	#cancelRecheck(accountId: string): void {
		const pending = this.#rechecks.get(accountId);
		if (pending) clearTimeout(pending.timer);
		this.#rechecks.delete(accountId);
	}

	#forget(accountId: string): void {
		const pending = this.#rechecks.get(accountId);
		if (pending) clearTimeout(pending.timer);
		this.#rechecks.delete(accountId);
		this.#verified.delete(accountId);
		if (accountId === this.#accountId) this.verification = 'unknown';
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
