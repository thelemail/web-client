import type { HarnessReply, HarnessRequest } from './harness.worker';
import { Coverage, Dimension, Field, Flag, Role, SourceKind, type SearchDocument } from './types';

export class Harness {
	#worker = new Worker(new URL('./harness.worker.ts', import.meta.url), { type: 'module' });
	#next = 0;
	#pending = new Map<number, (r: HarnessReply) => void>();

	constructor() {
		this.#worker.onmessage = (e: MessageEvent<HarnessReply>) => {
			this.#pending.get(e.data.id)?.(e.data);
			this.#pending.delete(e.data.id);
		};
	}

	call<T = unknown>(r: HarnessRequest): Promise<T> {
		const id = this.#next++;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, (reply) => (reply.ok ? resolve(reply.value as T) : reject(new Error(reply.error))));
			this.#worker.postMessage({ ...r, id });
		});
	}

	select<T extends unknown[] = unknown[]>(sql: string, bind?: (string | number | null)[]): Promise<T[]> {
		return this.call<T[]>({ op: 'select', sql, bind });
	}

	terminate() {
		this.#worker.terminate();
		for (const resolve of this.#pending.values()) resolve({ id: -1, ok: false, error: 'terminated' });
		this.#pending.clear();
	}
}

export function document(sourceId: string, overrides: Partial<SearchDocument> = {}): SearchDocument {
	return {
		kind: SourceKind.message,
		sourceId,
		contentRevision: 1,
		metadataRevision: 1,
		threadId: `thread-${sourceId}`,
		messageId: `<${sourceId}@calloway.test>`,
		date: 1_760_000_000_000,
		size: 2048,
		flags: Flag.inbox,
		knownFlags: Flag.read | Flag.starred | Flag.inbox,
		collections: [],
		subject: `Subject of ${sourceId}`,
		participants: [
			{ role: Role.from, name: 'Ada Calloway', address: 'ada@calloway.test' },
			{ role: Role.to, name: 'Bram Calloway', address: 'bram@calloway.test' }
		],
		attachments: [],
		parts: [{ field: Field.body, text: `Body of ${sourceId}.` }],
		coverage: { [Dimension.metadata]: Coverage.complete, [Dimension.body]: Coverage.complete },
		...overrides
	};
}

export function randomKey(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(32));
}

export function randomDirectory(): string {
	return `search-test-${crypto.randomUUID()}`;
}

export async function removeDirectory(name: string): Promise<void> {
	const root = await navigator.storage.getDirectory().catch(() => null);
	await root?.removeEntry(name, { recursive: true }).catch(() => {});
}
