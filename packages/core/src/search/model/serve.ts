import type { EmbeddedPassage, EmbedInput, ModelFailure, ModelMessage, ModelRequest } from './protocol';
import type { Passage } from './recipe';

export interface EmbedderLike {
	passages(input: EmbedInput): Passage[];
	vector(ids: readonly number[]): Promise<Float32Array>;
	query(text: string): Promise<Float32Array>;
	release(): Promise<void>;
}

export interface ServeModelDeps {
	load(progress: (bytes: number) => void, offline: boolean): Promise<EmbedderLike>;
	total: number;
	failureOf(error: unknown): ModelFailure;
}

type Lane = 'query' | 'batch';

export class PriorityLock {
	#held = false;
	#waiting: Record<Lane, (() => void)[]> = { query: [], batch: [] };

	async run<T>(lane: Lane, fn: () => Promise<T>): Promise<T> {
		if (this.#held) await new Promise<void>((resolve) => this.#waiting[lane].push(resolve));
		this.#held = true;
		try {
			return await fn();
		} finally {
			const next = this.#waiting.query.shift() ?? this.#waiting.batch.shift();
			if (next) next();
			else this.#held = false;
		}
	}
}

const PROGRESS_STEP = 1 << 20;

function turn(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

export function serveModel(port: MessagePort, deps: ServeModelDeps): void {
	const lock = new PriorityLock();
	const cancelled = new Set<number>();
	let loading: Promise<EmbedderLike> | null = null;
	let loaded = 0;
	let reported = 0;

	const post = (message: ModelMessage, transfer: Transferable[] = []) => port.postMessage(message, transfer);
	const fail = (id: number, error: unknown) => post({ type: 'reply', id, ok: false, reason: deps.failureOf(error) });

	const load = (offline = false) => {
		if (loading) return loading;
		const started = deps.load((bytes) => {
			loaded += bytes;
			if (loaded - reported >= PROGRESS_STEP || loaded >= deps.total) {
				reported = loaded;
				post({ type: 'progress', loaded: Math.min(loaded, deps.total), total: deps.total });
			}
		}, offline);
		loading = offline
			? started.catch((error: unknown) => {
					loading = null;
					loaded = 0;
					reported = 0;
					throw error;
				})
			: started;
		return loading;
	};

	async function embed(id: number, input: EmbedInput): Promise<void> {
		try {
			const embedder = await load();
			const passages = embedder.passages(input);
			const out: EmbeddedPassage[] = [];
			for (const p of passages) {
				await turn();
				if (cancelled.has(id)) {
					post({ type: 'reply', id, ok: false, reason: 'cancelled' });
					return;
				}
				const vector = await lock.run('batch', () => embedder.vector(p.ids));
				out.push({ field: p.field, attachmentId: p.attachmentId, place: p.place, refs: p.refs, vector });
			}
			post({ type: 'reply', id, ok: true, value: out }, out.map((p) => p.vector.buffer));
		} catch (error) {
			fail(id, error);
		} finally {
			cancelled.delete(id);
		}
	}

	async function query(id: number, text: string): Promise<void> {
		try {
			const embedder = await load();
			const vector = await lock.run('query', () => embedder.query(text));
			post({ type: 'reply', id, ok: true, value: vector }, [vector.buffer]);
		} catch (error) {
			fail(id, error);
		}
	}

	port.onmessage = (e: MessageEvent<ModelRequest>) => {
		const r = e.data;
		if (!r || typeof r !== 'object' || !Number.isSafeInteger(r.id)) return;
		switch (r.op) {
			case 'load':
				load(r.offline === true).then(
					() => post({ type: 'reply', id: r.id, ok: true, value: null }),
					(error: unknown) => fail(r.id, error)
				);
				return;
			case 'embed':
				void embed(r.id, r.input);
				return;
			case 'query':
				void query(r.id, r.text);
				return;
			case 'cancel':
				cancelled.add(r.id);
				return;
		}
	};
	port.start();
}
