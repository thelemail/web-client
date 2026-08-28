import { keystore } from '$lib/keystore/keystore-client';
import { auth } from '$lib/stores/auth.svelte';
import { mailbox } from '$lib/stores/mailbox.svelte';
import { unread } from '$lib/stores/unread.svelte';
import { drafts } from '$lib/stores/drafts.svelte';
import { scheduled } from '$lib/stores/scheduled.svelte';
import { applyHint } from './dispatch';
import { RealtimeConnection } from './connection';
import { electLeader, type LeaderHandle } from './leader';
import { openRealtimeChannel, type RealtimeChannel } from './channel';
import type { ConnectionState, RealtimeHint } from './types';

const LEADER_LOCK_NAME = 'thelemail:realtime-leader';
const STALE_MS = 60_000;

class RealtimeStore {
	#connections = new Map<string, RealtimeConnection>();
	#states = $state(new Map<string, ConnectionState>());
	#unsubKeystore: (() => void) | null = null;
	#leaderHandle: LeaderHandle | null = null;
	#channel: RealtimeChannel | null = null;
	#started = false;
	#lastWakeAt = Date.now();

	start(): () => void {
		if (this.#started) return () => this.stop();
		this.#started = true;
		this.#lastWakeAt = Date.now();

		this.#leaderHandle = electLeader(LEADER_LOCK_NAME, () => {
			this.#channel = openRealtimeChannel((msg) => {
				if (msg.type === 'hint') applyHint(msg.hint);
			});
			void this.sync();
			return () => {
				this.#channel?.close();
				this.#channel = null;
				for (const conn of this.#connections.values()) conn.stop();
				this.#connections.clear();
				this.#states = new Map();
			};
		});

		this.#unsubKeystore = keystore.subscribe((b) => {
			if (
				b.type === 'vaultChanged' ||
				b.type === 'locked' ||
				b.type === 'cleared' ||
				b.type === 'clearedAll'
			) {
				void this.sync();
			}
		});

		void this.sync();

		return () => this.stop();
	}

	stop(): void {
		if (!this.#started) return;
		this.#started = false;
		this.#unsubKeystore?.();
		this.#unsubKeystore = null;
		this.#leaderHandle?.stop();
		this.#leaderHandle = null;
	}

	async sync(): Promise<void> {
		if (!this.#leaderHandle?.isLeader) return;
		let status;
		try {
			status = await keystore.status();
		} catch {
			return;
		}
		if (!this.#leaderHandle?.isLeader) return;

		const unlockedIds = new Set(status.accounts.filter((a) => a.unlocked).map((a) => a.accountId));

		for (const id of [...this.#connections.keys()]) {
			if (unlockedIds.has(id)) continue;
			this.#connections.get(id)?.stop();
			this.#connections.delete(id);
			this.#removeState(id);
		}

		for (const id of unlockedIds) {
			if (this.#connections.has(id)) continue;
			const conn = new RealtimeConnection({
				accountId: id,
				onHint: (hint) => this.#onHint(hint),
				onState: (state, downMs) => this.#onConnState(id, state, downMs)
			});
			this.#connections.set(id, conn);
			conn.start();
		}
	}

	wake(): void {
		const now = Date.now();
		const hiddenMs = now - this.#lastWakeAt;
		this.#lastWakeAt = now;
		for (const conn of this.#connections.values()) conn.kick();
		if (hiddenMs >= STALE_MS) {
			for (const accountId of this.#connections.keys()) {
				this.#resync(accountId, true);
			}
		}
	}

	stateFor(accountId: string): ConnectionState {
		return this.#states.get(accountId) ?? 'idle';
	}

	get leading(): boolean {
		return this.#leaderHandle?.isLeader ?? false;
	}

	#onHint(hint: RealtimeHint): void {
		applyHint(hint);
		this.#channel?.post({ type: 'hint', hint });
	}

	#onConnState(id: string, state: ConnectionState, downMs: number): void {
		this.#setState(id, state);
		if (state === 'open' && downMs > 0) {
			this.#resync(id, downMs >= STALE_MS);
		}
	}

	#resync(accountId: string, full: boolean): void {
		if (accountId !== auth.accountId) {
			void unread.refresh(accountId);
			return;
		}
		if (full) {
			void mailbox.refreshLoaded();
			void drafts.refresh();
			void scheduled.refresh();
		}
		void mailbox.refreshCounts();
	}

	#setState(id: string, state: ConnectionState): void {
		const map = new Map(this.#states);
		map.set(id, state);
		this.#states = map;
	}

	#removeState(id: string): void {
		if (!this.#states.has(id)) return;
		const map = new Map(this.#states);
		map.delete(id);
		this.#states = map;
	}
}

export const realtime = new RealtimeStore();
