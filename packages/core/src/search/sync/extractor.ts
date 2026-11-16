import type { Extracted, ExtractRequest } from '../extract/extract';

const JOB_TIMEOUT_MS = 20_000;

export type ExtractResult = { ok: true; value: Extracted } | { ok: false; reason: 'timeout' | 'crashed' };

export interface ExtractorPort {
	extract(request: ExtractRequest): Promise<ExtractResult>;
	close(): void;
}

export class Extractor implements ExtractorPort {
	#spawn: () => Worker;
	#worker: Worker | null = null;
	#next = 0;
	#pending = new Map<number, (r: ExtractResult) => void>();

	constructor(spawn: () => Worker) {
		this.#spawn = spawn;
	}

	#ensure(): Worker {
		if (this.#worker) return this.#worker;
		const worker = this.#spawn();
		worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: Extracted }>) => {
			const resolve = this.#pending.get(e.data.id);
			if (!resolve) return;
			this.#pending.delete(e.data.id);
			resolve(e.data.ok ? { ok: true, value: e.data.value! } : { ok: false, reason: 'crashed' });
		};
		worker.onerror = () => this.#reset('crashed');
		this.#worker = worker;
		return worker;
	}

	#reset(reason: 'timeout' | 'crashed'): void {
		this.#worker?.terminate();
		this.#worker = null;
		const pending = [...this.#pending.values()];
		this.#pending.clear();
		for (const resolve of pending) resolve({ ok: false, reason });
	}

	extract(request: ExtractRequest): Promise<ExtractResult> {
		const worker = this.#ensure();
		const id = this.#next++;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				if (this.#pending.has(id)) this.#reset('timeout');
			}, JOB_TIMEOUT_MS);
			this.#pending.set(id, (r) => {
				clearTimeout(timer);
				resolve(r);
			});
			worker.postMessage({ id, request }, [request.bytes.buffer]);
		});
	}

	close(): void {
		this.#reset('crashed');
	}
}
