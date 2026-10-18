import { browser } from '$app/environment';
import { listMyKeys } from '$core/api/me';
import { ApiCallError, type AccountKeyListResponse } from '$core/api/types';
import { keystore } from '$core/keystore/keystore-client';
import type { AccountKeySummary } from '$core/keystore/protocol';
import { bytesToHex } from '$core/keys/encode';
import { isProductVault } from '$core/products';
import { decodeStrictBase64 } from '$core/directory/statement';
import { DirectoryVerificationError } from '$core/directory/errors';
import { m } from '$paraglide/messages.js';

export interface CurrentAccountKey {
	fingerprintHex: string;
	keyVersion: number;
	publicKeyArmored: string;
}

export type OwnKeyVerification = 'unknown' | 'verified' | 'pending' | 'unverified' | 'unreachable';

export type OwnKeyBlock = 'unverified' | 'unreachable';

interface OwnKeyVerdict {
	fingerprintHex: string;
	state: OwnKeyVerification;
}

const RECHECK_BASE_MS = 30_000;
const RECHECK_MAX_MS = 10 * 60_000;
const RECHECK_LIMIT = 8;
const VERDICT_CHANNEL = 'thelemail-own-key';
const VERDICT_STATES: ReadonlySet<string> = new Set(['verified', 'pending', 'unverified', 'unreachable']);
const FINGERPRINT_HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export class OwnKeyUnconfirmedError extends Error {
	readonly code: 'account_key_unverified' | 'account_key_unchecked';

	constructor(block: OwnKeyBlock) {
		super(block === 'unverified' ? m.account_key_unverified() : m.account_key_unchecked());
		this.name = 'OwnKeyUnconfirmedError';
		this.code = block === 'unverified' ? 'account_key_unverified' : 'account_key_unchecked';
	}
}

class AccountKeysStore {
	current = $state<CurrentAccountKey | null>(null);
	history = $state<AccountKeySummary[]>([]);
	authScheme = $state<'srp_v1' | 'opaque_v1' | null>(null);
	error = $state<'history_incomplete' | 'account_keys_unavailable' | null>(null);
	verification = $state<OwnKeyVerification>('unknown');
	#accountId: string | null = null;
	#ready = new Map<string, Promise<void>>();
	#unsubscribe: (() => void) | null = null;
	#verdicts = new Map<string, OwnKeyVerdict>();
	#inflight = new Map<string, Promise<OwnKeyVerdict | null>>();
	#primary = new Map<string, string>();
	#rechecks = new Map<string, { timer: ReturnType<typeof setTimeout>; attempt: number }>();
	#channel: BroadcastChannel | null = null;

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.#accountId = accountId;
		this.current = null;
		this.history = [];
		this.error = null;
		this.#publish();
		this.#watch();
	}

	async confirm(accountId: string): Promise<OwnKeyBlock | null> {
		if (!browser || isProductVault) return null;
		const status = await keystore.status().catch(() => null);
		const account = status?.accounts.find((a) => a.accountId === accountId);
		if (!account?.unlocked || account.authScheme !== 'opaque_v1') return null;
		await this.ready(accountId);
		const pub = await keystore.getPublicKey({ accountId }).catch(() => null);
		if (!pub?.ok) return null;
		const fingerprintHex = bytesToHex(pub.fingerprint);
		let verdict = this.#verdicts.get(accountId) ?? null;
		if (!verdict || verdict.fingerprintHex !== fingerprintHex || verdict.state === 'unreachable') {
			verdict = await this.#verify(accountId, true);
		}
		if (!verdict || verdict.fingerprintHex !== fingerprintHex) return 'unreachable';
		if (verdict.state === 'unverified' || verdict.state === 'unreachable') return verdict.state;
		return verdict.state === 'unknown' ? 'unreachable' : null;
	}

	#watch(): void {
		if (!browser || this.#unsubscribe) return;
		this.#listen();
		this.#unsubscribe = keystore.subscribe((b) => {
			if (b.type === 'clearedAll') {
				this.#ready.clear();
				for (const id of [...this.#verdicts.keys(), ...this.#rechecks.keys()]) this.#forget(id);
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
			if (b.type === 'accountKeysChanged') {
				void (async () => {
					if (b.accountId === this.#accountId) await this.#refreshLocal(b.accountId);
					if (b.currentChanged) await this.#recheck(b.accountId);
				})();
			}
		});
	}

	#listen(): void {
		if (typeof BroadcastChannel === 'undefined') return;
		this.#channel = new BroadcastChannel(VERDICT_CHANNEL);
		this.#channel.onmessage = (ev: MessageEvent) => {
			const data = ev.data as { accountId?: unknown; fingerprintHex?: unknown; state?: unknown } | null;
			if (
				!data ||
				typeof data.accountId !== 'string' ||
				typeof data.fingerprintHex !== 'string' ||
				!FINGERPRINT_HEX.test(data.fingerprintHex) ||
				typeof data.state !== 'string' ||
				!VERDICT_STATES.has(data.state)
			) {
				return;
			}
			this.#record(
				data.accountId,
				{ fingerprintHex: data.fingerprintHex, state: data.state as OwnKeyVerification },
				false
			);
		};
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
		let checks = false;
		try {
			const status = await keystore.status();
			const account = status.accounts.find((a) => a.accountId === accountId);
			if (!account?.unlocked) return;
			checks = account.authScheme === 'opaque_v1' && !isProductVault;
			const list = checks ? await this.#serverKeys(accountId) : null;
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
			}
		} catch {
			if (accountId === this.#accountId) {
				this.error = 'account_keys_unavailable';
			}
		}
		await this.#refreshLocal(accountId);
		if (!checks) return;
		const verdict = await this.#verify(accountId, again);
		if (verdict?.state === 'unverified' && !again) await this.#fetch(accountId, true);
	}

	async #serverKeys(accountId: string): Promise<AccountKeyListResponse | null> {
		try {
			return await listMyKeys(accountId);
		} catch (err) {
			if (err instanceof ApiCallError && err.status === 404) return null;
			throw err;
		}
	}

	async #recheck(accountId: string): Promise<void> {
		const verdict = await this.#verify(accountId, false);
		if (verdict?.state === 'unverified') await this.load(accountId);
	}

	#verify(accountId: string, final: boolean): Promise<OwnKeyVerdict | null> {
		const running = this.#inflight.get(accountId);
		if (running) return running;
		const pending = this.#check(accountId, final).finally(() => this.#inflight.delete(accountId));
		this.#inflight.set(accountId, pending);
		return pending;
	}

	async #check(accountId: string, final: boolean): Promise<OwnKeyVerdict | null> {
		const [pub, status] = await Promise.all([
			keystore.getPublicKey({ accountId }).catch(() => null),
			keystore.status().catch(() => null)
		]);
		if (!pub?.ok) return null;
		const address = this.#primary.get(accountId) ?? status?.accounts.find((a) => a.accountId === accountId)?.email;
		const fingerprintHex = bytesToHex(pub.fingerprint);
		const verdict: OwnKeyVerdict = {
			fingerprintHex,
			state: address ? await this.#ownStatement(accountId, address.trim().toLowerCase(), fingerprintHex) : 'unreachable'
		};
		if (verdict.state === 'unverified' && !final) return verdict;
		this.#record(accountId, verdict, true);
		if (verdict.state === 'pending' || verdict.state === 'unreachable') this.#scheduleRecheck(accountId);
		else this.#cancelRecheck(accountId);
		return this.#verdicts.get(accountId) ?? verdict;
	}

	async #ownStatement(accountId: string, address: string, fingerprintHex: string): Promise<OwnKeyVerification> {
		try {
			const [{ lookupDirectory }, { verifyOwnStatement }] = await Promise.all([
				import('$core/directory/lookup'),
				import('$core/directory/verify')
			]);
			const lookup = await lookupDirectory(address);
			const res = await verifyOwnStatement(lookup, address, { accountId, keyFingerprint: fingerprintHex });
			return res.state;
		} catch (err) {
			return err instanceof DirectoryVerificationError ? 'unverified' : 'unreachable';
		}
	}

	#record(accountId: string, verdict: OwnKeyVerdict, share: boolean): void {
		const previous = this.#verdicts.get(accountId);
		if (
			previous?.state === 'unverified' &&
			previous.fingerprintHex === verdict.fingerprintHex &&
			(verdict.state === 'pending' || verdict.state === 'unreachable')
		) {
			return;
		}
		this.#verdicts.set(accountId, verdict);
		if (share) this.#channel?.postMessage({ accountId, ...verdict });
		if (accountId === this.#accountId) this.#publish();
	}

	#publish(): void {
		const verdict = this.#accountId ? this.#verdicts.get(this.#accountId) : undefined;
		const current = this.current?.fingerprintHex;
		this.verification = verdict && (!current || current === verdict.fingerprintHex) ? verdict.state : 'unknown';
	}

	#scheduleRecheck(accountId: string): void {
		const attempt = (this.#rechecks.get(accountId)?.attempt ?? 0) + 1;
		this.#cancelRecheck(accountId);
		if (attempt > RECHECK_LIMIT) return;
		const delay = Math.min(RECHECK_BASE_MS * 2 ** (attempt - 1), RECHECK_MAX_MS);
		const timer = setTimeout(() => {
			this.#rechecks.set(accountId, { timer, attempt });
			void this.#recheck(accountId);
		}, delay);
		this.#rechecks.set(accountId, { timer, attempt });
	}

	#cancelRecheck(accountId: string): void {
		const pending = this.#rechecks.get(accountId);
		if (pending) clearTimeout(pending.timer);
		this.#rechecks.delete(accountId);
	}

	#forget(accountId: string): void {
		this.#cancelRecheck(accountId);
		this.#verdicts.delete(accountId);
		this.#inflight.delete(accountId);
		if (accountId === this.#accountId) this.#publish();
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
			this.#publish();
			return;
		}
		this.current = {
			fingerprintHex: bytesToHex(pub.fingerprint),
			keyVersion: pub.keyVersion ?? 1,
			publicKeyArmored: pub.publicKeyArmored
		};
		this.history = list?.ok ? list.keys.filter((k) => !k.isCurrent) : [];
		this.#publish();
	}
}

export const accountKeys = new AccountKeysStore();

export async function requireConfirmedOwnKey(accountId: string): Promise<void> {
	const block = await accountKeys.confirm(accountId);
	if (block) throw new OwnKeyUnconfirmedError(block);
}
