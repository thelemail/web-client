import type { SearchWriter } from '../sqlite/writer';
import type { PutResult, SearchDocument } from '../sqlite/types';
import { admit, isQuotaError, type Admission } from './quota';

export const BATCH_SOURCES = 250;
export const BATCH_BYTES = 2 * 1024 * 1024;

export type CommitResult = { ok: true; results: PutResult[] } | { ok: false; reason: 'quota' };

export function textSize(doc: SearchDocument): number {
	let size = doc.subject?.length ?? 0;
	for (const p of doc.participants) size += p.name.length + p.address.length;
	for (const a of doc.attachments) size += a.filename.length;
	for (const p of doc.parts) size += p.text.length;
	return size;
}

export class Batch {
	#writer: SearchWriter;
	#job: string;
	#admit: (bytes: number) => Promise<Admission>;
	#docs: SearchDocument[] = [];
	#bytes = 0;
	#cursor: string | null = null;
	#dirty = false;

	constructor(writer: SearchWriter, job: string, admission: (bytes: number) => Promise<Admission> = admit) {
		this.#writer = writer;
		this.#job = job;
		this.#admit = admission;
	}

	get full(): boolean {
		return this.#docs.length >= BATCH_SOURCES || this.#bytes >= BATCH_BYTES;
	}

	get size(): number {
		return this.#docs.length;
	}

	resume(): string | null {
		return this.#writer.checkpoint(this.#job);
	}

	add(doc: SearchDocument, cursor: string | null): boolean {
		this.#docs.push(doc);
		this.#bytes += textSize(doc);
		this.advance(cursor);
		return this.full;
	}

	advance(cursor: string | null): void {
		this.#cursor = cursor;
		this.#dirty = true;
	}

	async commit(): Promise<CommitResult> {
		if (!this.#dirty) return { ok: true, results: [] };
		const admission = await this.#admit(this.#bytes * 2);
		if (!admission.ok) return admission;
		let results: PutResult[];
		try {
			results = this.#writer.putBatch(this.#docs, { job: this.#job, cursor: this.#cursor });
		} catch (error) {
			if (isQuotaError(error)) return { ok: false, reason: 'quota' };
			throw error;
		}
		this.#docs = [];
		this.#bytes = 0;
		this.#dirty = false;
		return { ok: true, results };
	}
}
