import { browser } from '$app/environment';
import { listMyCalendarKeys, type CalendarKeyGrant } from '$core/api/calendars';
import { keystore } from '$core/keystore/keystore-client';
import { b64ToHex, b64ToText } from '$lib/keys/encode';

const REFRESH_INTERVAL_MS = 30_000;

export interface CalendarKeyMaterial {
	publicKeyArmored: string;
	fingerprintB64: string;
	fingerprintHex: string;
	keyVersion: number;
}

class CalendarKeysStore {
	loaded = $state(false);
	error = $state<string | null>(null);
	grants = $state<CalendarKeyGrant[]>([]);
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

	publicKeyFor(calendarId: string): CalendarKeyMaterial | null {
		const current =
			this.grants.find((g) => g.calendarId === calendarId && g.isCurrent) ??
			this.grants
				.filter((g) => g.calendarId === calendarId)
				.sort((a, b) => b.keyVersion - a.keyVersion)[0];
		if (!current) return null;
		return {
			publicKeyArmored: current.calendarPublicKeyArmored,
			fingerprintB64: current.calendarKeyFingerprint,
			fingerprintHex: b64ToHex(current.calendarKeyFingerprint),
			keyVersion: current.keyVersion
		};
	}

	hasKey(calendarId: string, fingerprintB64: string): boolean {
		return this.grants.some(
			(g) => g.calendarId === calendarId && g.calendarKeyFingerprint === fingerprintB64
		);
	}

	async #fetch(accountId: string): Promise<void> {
		if (!browser) return;
		this.#lastRefresh = Date.now();
		try {
			const { keys } = await listMyCalendarKeys();
			if (this.#accountId !== accountId) return;
			this.grants = keys;
			if (!keys.length) {
				this.loaded = true;
				return;
			}
			const res = await keystore.loadAliasKeys({
				accountId,
				grants: keys.map((k) => ({
					aliasId: k.calendarId,
					addressId: k.calendarId,
					email: '',
					name: 'Calendar',
					keyVersion: k.keyVersion,
					aliasKeyFingerprintHex: b64ToHex(k.calendarKeyFingerprint),
					wrappedPrivateKeyArmored: b64ToText(k.wrappedPrivateKey),
					isCurrent: k.isCurrent
				}))
			});
			if (this.#accountId !== accountId) return;
			this.loaded = res.ok;
			this.error = res.ok ? null : 'vault is locked';
		} catch (err) {
			if (this.#accountId !== accountId) return;
			this.error = err instanceof Error ? err.message : 'failed to load calendar keys';
			this.loaded = true;
		}
	}

	clear(): void {
		this.loaded = false;
		this.error = null;
		this.grants = [];
		this.#ready = null;
		this.#lastRefresh = 0;
	}
}

export const calendarKeys = new CalendarKeysStore();
