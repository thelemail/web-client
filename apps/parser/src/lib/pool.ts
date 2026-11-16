import type { ParseRequest, ParseResult } from '$core/search/extract/parse';
import type { ParseFailure } from '$core/search/parser/protocol';
import type { FromWorker, ToWorker } from './messages';

export const SLICE_MS = 10_000;
export const JOB_MS = 120_000;
const RECYCLE_JOBS = 20;
const RECYCLE_BYTES = 64 * 1024 * 1024;

export type PoolResult = { ok: true; result: ParseResult } | { ok: false; reason: ParseFailure };

interface Task {
	request: ParseRequest;
	resolve: (r: PoolResult) => void;
}

interface Slot {
	worker: Worker | null;
	jobs: number;
	bytes: number;
	busy: boolean;
	cancel: (() => void) | null;
}

export interface PoolOptions {
	spawn(): Worker;
	assets: ReadonlyMap<string, Uint8Array>;
	size: number;
	sliceMs?: number;
	jobMs?: number;
}

export function poolSize(): number {
	const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 1 : 1;
	const memory = typeof navigator !== 'undefined' ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) : 4;
	return cores >= 8 && memory >= 8 ? 2 : 1;
}

export class Pool {
	#options: PoolOptions;
	#slots: Slot[];
	#queue: Task[] = [];
	#next = 0;
	#closed = false;

	constructor(options: PoolOptions) {
		this.#options = options;
		this.#slots = Array.from({ length: Math.max(1, options.size) }, () => ({ worker: null, jobs: 0, bytes: 0, busy: false, cancel: null }));
	}

	run(request: ParseRequest): Promise<PoolResult> {
		if (this.#closed) return Promise.resolve({ ok: false, reason: 'unavailable' });
		return new Promise((resolve) => {
			this.#queue.push({ request, resolve });
			this.#drain();
		});
	}

	close(): void {
		this.#closed = true;
		for (const slot of this.#slots) {
			slot.cancel?.();
			this.#retire(slot);
		}
		for (const task of this.#queue.splice(0)) task.resolve({ ok: false, reason: 'unavailable' });
	}

	#drain(): void {
		for (const slot of this.#slots) {
			if (slot.busy) continue;
			const task = this.#queue.shift();
			if (!task) return;
			this.#start(slot, task);
		}
	}

	#worker(slot: Slot): Worker {
		if (slot.worker) return slot.worker;
		const worker = this.#options.spawn();
		const init: ToWorker = { type: 'init', assets: [...this.#options.assets].map(([k, v]) => [k, v.slice()]) };
		worker.postMessage(init);
		slot.worker = worker;
		slot.jobs = 0;
		slot.bytes = 0;
		return worker;
	}

	#retire(slot: Slot): void {
		slot.worker?.terminate();
		slot.worker = null;
	}

	#start(slot: Slot, task: Task): void {
		slot.busy = true;
		const worker = this.#worker(slot);
		const id = this.#next++;
		const size = task.request.bytes.byteLength;
		const sliceMs = this.#options.sliceMs ?? SLICE_MS;
		let slice: ReturnType<typeof setTimeout>;
		let settled = false;
		const finish = (r: PoolResult, kill: boolean) => {
			if (settled) return;
			settled = true;
			slot.cancel = null;
			clearTimeout(slice);
			clearTimeout(total);
			worker.removeEventListener('message', onMessage);
			worker.removeEventListener('error', onError);
			slot.jobs++;
			slot.bytes += size;
			if (kill || slot.jobs >= RECYCLE_JOBS || slot.bytes >= RECYCLE_BYTES) this.#retire(slot);
			slot.busy = false;
			task.resolve(r);
			if (!this.#closed) this.#drain();
		};
		const arm = () => {
			clearTimeout(slice);
			slice = setTimeout(() => finish({ ok: false, reason: 'timeout' }, true), sliceMs);
		};
		const total = setTimeout(() => finish({ ok: false, reason: 'timeout' }, true), this.#options.jobMs ?? JOB_MS);
		const onMessage = (e: MessageEvent<FromWorker>) => {
			const m = e.data;
			if (!m || typeof m !== 'object' || m.id !== id) return;
			if (m.type === 'tick') arm();
			else if (m.type === 'done') finish({ ok: true, result: m.result }, false);
			else if (m.type === 'error') finish({ ok: false, reason: 'crashed' }, true);
		};
		const onError = () => finish({ ok: false, reason: 'crashed' }, true);
		worker.addEventListener('message', onMessage);
		worker.addEventListener('error', onError);
		slot.cancel = () => finish({ ok: false, reason: 'unavailable' }, true);
		arm();
		const message: ToWorker = { type: 'job', id, request: task.request };
		worker.postMessage(message, [task.request.bytes.buffer]);
	}
}
