import { keystore } from '$core/keystore/keystore-client';
import { readinessOf, type AccountReadiness, type ProbeState } from '$core/mail/accountReadiness';
import { auth } from './auth.svelte';
import { unread } from './unread.svelte';

const FRESH_MS = 60_000;

class AccountReadinessStore {
	#probes = $state(new Map<string, ProbeState>());
	#checkedAt = new Map<string, number>();

	of(accountId: string): AccountReadiness {
		return readinessOf({
			unlocked: auth.vaultUnlockedFor(accountId),
			restorable: auth.hasPersistentFor(accountId),
			sessionLost: auth.sessionLost(accountId),
			probe: this.#probes.get(accountId) ?? 'idle',
			countsLoaded: unread.countsFor(accountId) !== null
		});
	}

	async probe(accountIds: string[], force = false): Promise<void> {
		const now = Date.now();
		const due = force
			? accountIds
			: accountIds.filter(
					(id) =>
						this.#probes.get(id) !== 'ok' || now - (this.#checkedAt.get(id) ?? 0) > FRESH_MS
				);
		if (due.length === 0) return;
		try {
			auth.syncFromKeystoreStatus(await keystore.status());
		} catch (err) {
			console.warn('accounts: keystore status unavailable', err);
		}
		await Promise.all(due.map((id) => this.#probeOne(id)));
	}

	async #probeOne(accountId: string): Promise<void> {
		if (this.#probes.get(accountId) === 'pending') return;
		if (auth.sessionLost(accountId)) return;
		if (!auth.vaultUnlockedFor(accountId) && !auth.hasPersistentFor(accountId)) return;
		this.#set(accountId, 'pending');
		await auth.ensureFreshToken(accountId);
		if (auth.sessionLost(accountId)) {
			this.#set(accountId, 'idle');
			return;
		}
		const loaded = await unread.refresh(accountId);
		if (loaded) this.#checkedAt.set(accountId, Date.now());
		this.#set(accountId, loaded ? 'ok' : 'failed');
	}

	#set(accountId: string, state: ProbeState): void {
		const m = new Map(this.#probes);
		m.set(accountId, state);
		this.#probes = m;
	}
}

export const accountReadiness = new AccountReadinessStore();
