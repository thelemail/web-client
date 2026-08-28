import { keystore } from '$lib/keystore/keystore-client';
import { applyHint } from './dispatch';
import { RealtimeConnection } from './connection';
import { electLeader, type LeaderHandle } from './leader';
import { openRealtimeChannel, type RealtimeChannel } from './channel';
import type { ConnectionState, RealtimeHint } from './types';

const LEADER_LOCK_NAME = 'thelemail:realtime-leader';

class RealtimeStore {
	#connections = new Map<string, RealtimeConnection>();
	#states = $state(new Map<string, ConnectionState>());
	#unsubKeystore: (() => void) | null = null;
	#leaderHandle: LeaderHandle | null = null;
	#channel: RealtimeChannel | null = null;
	#started = false;

	start(): () => void {
		if (this.#started) return () => this.stop();
		this.#started = true;

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
				onState: (state) => this.#setState(id, state)
			});
			this.#connections.set(id, conn);
			conn.start();
		}
	}

	wake(): void {
		for (const conn of this.#connections.values()) conn.kick();
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
