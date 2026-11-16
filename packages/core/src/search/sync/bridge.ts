import type { BridgeMessage, BridgeReply, BridgeRequest, BridgeResult, BridgeValues } from './protocol';

const CALL_TIMEOUT_MS = 180_000;

type Op = BridgeRequest['op'];

export interface BridgeCaller {
	call<K extends Op>(request: Extract<BridgeRequest, { op: K }>): Promise<BridgeResult<BridgeValues[K]>>;
}

export class Bridge implements BridgeCaller {
	#port: MessagePort;
	#next = 0;
	#pending = new Map<number, { resolve: (r: BridgeResult<unknown>) => void; timer: ReturnType<typeof setTimeout> }>();
	#closed = false;

	constructor(port: MessagePort) {
		this.#port = port;
		port.onmessage = (e: MessageEvent<BridgeReply>) => {
			const pending = this.#pending.get(e.data.id);
			if (!pending) return;
			this.#pending.delete(e.data.id);
			clearTimeout(pending.timer);
			pending.resolve(e.data.result);
		};
		port.start();
	}

	call<K extends Op>(request: Extract<BridgeRequest, { op: K }>): Promise<BridgeResult<BridgeValues[K]>> {
		if (this.#closed) return Promise.resolve({ ok: false, failure: { code: 'vault_locked' } });
		const id = this.#next++;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				resolve({ ok: false, failure: { code: 'retry', retryAfterSeconds: null } });
			}, CALL_TIMEOUT_MS);
			this.#pending.set(id, { resolve: resolve as (r: BridgeResult<unknown>) => void, timer });
			this.#port.postMessage({ ...request, id } satisfies BridgeMessage);
		});
	}

	close(): void {
		this.#closed = true;
		for (const p of this.#pending.values()) {
			clearTimeout(p.timer);
			p.resolve({ ok: false, failure: { code: 'vault_locked' } });
		}
		this.#pending.clear();
		this.#port.onmessage = null;
		this.#port.close();
	}
}
