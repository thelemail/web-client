import type { ClaimModelLeaseResponse, RenewModelLeaseResponse, SearchSessionEvent } from '../../keystore/protocol';
import { sessionCall } from '../runtime/session';
import type { EmbeddedPassage, EmbedInput, ModelCall, ModelFailure, ModelMessage, ModelRequest } from './protocol';

export type Unavailable = 'memory' | 'wasm' | 'assets' | 'owner';

export type ModelState =
	| { state: 'idle' }
	| { state: 'waiting' }
	| { state: 'downloading'; loaded: number; total: number }
	| { state: 'loading' }
	| { state: 'ready' }
	| { state: 'unavailable'; reason: Unavailable };

export type Acquired = { ok: true } | { ok: false; retryMs: number } | { ok: false; unavailable: Unavailable };

export type Embedded = { ok: true; passages: EmbeddedPassage[] } | { ok: false; reason: ModelFailure };

export interface ModelHost {
	keystore(): MessagePort | null;
	spawn(): Promise<MessagePort | null>;
	stop(): void;
	changed(): void;
}

export const IDLE_RELEASE_MS = 60_000;
export const ASSET_RETRY_MS = 10 * 60_000;
const LEASE_RETRY_MS = 10_000;
const PERMANENT: readonly ModelFailure[] = ['memory', 'wasm'];

interface Pending {
	resolve(message: Extract<ModelMessage, { type: 'reply' }>): void;
}

export class ModelLink {
	#host: ModelHost;
	#state: ModelState = { state: 'idle' };
	#fence: number | null = null;
	#port: MessagePort | null = null;
	#loaded = false;
	#next = 0;
	#pending = new Map<number, Pending>();
	#idle: ReturnType<typeof setTimeout> | null = null;
	#keystore: MessagePort | null = null;
	#onEvent = (e: MessageEvent<SearchSessionEvent>) => {
		if (e.data?.type === 'event' && e.data.event === 'modelFenced' && e.data.fence === this.#fence) void this.release();
	};

	constructor(host: ModelHost) {
		this.#host = host;
	}

	get state(): ModelState {
		return this.#state;
	}

	get fence(): number | null {
		return this.#fence;
	}

	#set(state: ModelState): void {
		this.#state = state;
		this.#host.changed();
	}

	#listen(port: MessagePort | null): void {
		if (this.#keystore === port) return;
		this.#keystore?.removeEventListener('message', this.#onEvent as EventListener);
		this.#keystore = port;
		port?.addEventListener('message', this.#onEvent as EventListener);
		port?.start();
	}

	unavailable(reason: Unavailable): void {
		void this.release(false);
		this.#set({ state: 'unavailable', reason });
	}

	async acquire(): Promise<Acquired> {
		if (this.#idle !== null) clearTimeout(this.#idle);
		this.#idle = null;
		const keystore = this.#host.keystore();
		if (!keystore) {
			this.unavailable('owner');
			return { ok: false, unavailable: 'owner' };
		}
		this.#listen(keystore);
		const claim = await sessionCall<ClaimModelLeaseResponse>(keystore, 'claimModelLease');
		if (!claim) return { ok: false, retryMs: LEASE_RETRY_MS };
		if (!claim.ok) {
			if (claim.code !== 'busy') return { ok: false, retryMs: LEASE_RETRY_MS };
			await this.release(false);
			this.#set({ state: 'waiting' });
			return { ok: false, retryMs: claim.retryMs };
		}
		if (this.#fence !== null && this.#fence !== claim.fence) await this.release(false);
		this.#fence = claim.fence;
		if (this.#port && this.#loaded) return { ok: true };
		if (!this.#port) {
			const port = await this.#host.spawn();
			if (this.#fence !== claim.fence) {
				port?.close();
				return { ok: false, retryMs: LEASE_RETRY_MS };
			}
			if (!port) {
				this.unavailable('owner');
				return { ok: false, unavailable: 'owner' };
			}
			this.#attach(port);
		}
		this.#set({ state: 'loading' });
		const reply = await this.#call({ op: 'load' });
		if (this.#state.state === 'unavailable') return { ok: false, unavailable: this.#state.reason };
		if (this.#fence !== claim.fence) return { ok: false, retryMs: LEASE_RETRY_MS };
		if (reply.ok) {
			this.#loaded = true;
			this.#set({ state: 'ready' });
			return { ok: true };
		}
		if (reply.reason === 'assets') {
			this.unavailable('assets');
			return { ok: false, retryMs: ASSET_RETRY_MS };
		}
		const reason: Unavailable = reply.reason === 'wasm' ? 'wasm' : 'memory';
		this.unavailable(reason);
		return { ok: false, unavailable: reason };
	}

	#attach(port: MessagePort): void {
		this.#port = port;
		this.#loaded = false;
		port.onmessage = (e: MessageEvent<ModelMessage>) => {
			const m = e.data;
			if (port !== this.#port) return;
			if (m.type === 'progress') {
				this.#set({ state: 'downloading', loaded: m.loaded, total: m.total });
				return;
			}
			const pending = this.#pending.get(m.id);
			if (!pending) return;
			this.#pending.delete(m.id);
			pending.resolve(m);
		};
		port.start();
	}

	crashed(): void {
		const loading = !this.#loaded;
		this.#drop();
		if (loading && this.#fence !== null) this.unavailable('memory');
	}

	#call(request: ModelCall, signal?: AbortSignal): Promise<Extract<ModelMessage, { type: 'reply' }>> {
		const port = this.#port;
		const id = this.#next++;
		if (!port) return Promise.resolve({ type: 'reply', id, ok: false, reason: 'closed' });
		return new Promise((resolve) => {
			const onAbort = () => port.postMessage({ op: 'cancel', id } satisfies ModelRequest);
			signal?.addEventListener('abort', onAbort, { once: true });
			this.#pending.set(id, {
				resolve: (m) => {
					signal?.removeEventListener('abort', onAbort);
					resolve(m);
				}
			});
			port.postMessage({ ...request, id } as ModelRequest);
		});
	}

	async embed(input: EmbedInput, signal?: AbortSignal): Promise<Embedded> {
		const fence = this.#fence;
		const reply = await this.#call({ op: 'embed', input }, signal);
		if (fence === null || fence !== this.#fence) return { ok: false, reason: 'closed' };
		if (!reply.ok) {
			if (PERMANENT.includes(reply.reason)) this.unavailable(reply.reason === 'wasm' ? 'wasm' : 'memory');
			return { ok: false, reason: reply.reason };
		}
		return { ok: true, passages: reply.value as EmbeddedPassage[] };
	}

	async check(fence: number | null = this.#fence): Promise<boolean> {
		const keystore = this.#host.keystore();
		if (fence === null || !keystore || fence !== this.#fence) return false;
		const renewed = await sessionCall<RenewModelLeaseResponse>(keystore, 'renewModelLease', { fence });
		if (renewed?.ok && renewed.live && fence === this.#fence) return true;
		if (fence === this.#fence) await this.release(false);
		return false;
	}

	idleSoon(): void {
		if (this.#idle !== null || this.#fence === null) return;
		this.#idle = setTimeout(() => {
			this.#idle = null;
			void this.release();
		}, IDLE_RELEASE_MS);
	}

	#drop(): void {
		const port = this.#port;
		this.#port = null;
		this.#loaded = false;
		for (const [id, p] of this.#pending) p.resolve({ type: 'reply', id, ok: false, reason: 'closed' });
		this.#pending.clear();
		if (port) {
			port.onmessage = null;
			port.close();
			this.#host.stop();
		}
	}

	async release(idle = true): Promise<void> {
		if (this.#idle !== null) clearTimeout(this.#idle);
		this.#idle = null;
		const fence = this.#fence;
		this.#fence = null;
		this.#drop();
		const keystore = this.#host.keystore();
		if (fence !== null && keystore) await sessionCall(keystore, 'releaseModelLease', { fence });
		if (idle && this.#state.state !== 'unavailable') this.#set({ state: 'idle' });
	}

	close(): void {
		if (this.#idle !== null) clearTimeout(this.#idle);
		this.#idle = null;
		this.#fence = null;
		this.#drop();
		this.#listen(null);
	}
}
