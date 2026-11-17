import type { ParseRequest, ParseResult } from '../extract/parse';
import type { JobInput, JobOutcome, JobTicket, ParseFailure } from '../parser/protocol';

const OUTER_TIMEOUT_MS = 150_000;

export type ParseOutcome = { ok: true; result: ParseResult } | { ok: false; reason: ParseFailure };

export interface ParseMeta {
	source: string;
	revision: number;
}

export interface ExtractorPort {
	parse(request: ParseRequest, meta: ParseMeta): Promise<ParseOutcome>;
	close(): void;
}

function jobId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class ParserClient implements ExtractorPort {
	#port: MessagePort | null;
	#pending = new Set<(outcome: ParseOutcome) => void>();

	constructor(port: MessagePort | null) {
		this.#port = port;
	}

	parse(request: ParseRequest, meta: ParseMeta): Promise<ParseOutcome> {
		const port = this.#port;
		if (!port) return Promise.resolve({ ok: false, reason: 'unavailable' });
		const id = jobId();
		const channel = new MessageChannel();
		return new Promise<ParseOutcome>((resolve) => {
			const finish = (outcome: ParseOutcome) => {
				if (!this.#pending.delete(finish)) return;
				clearTimeout(timer);
				channel.port1.onmessage = null;
				channel.port1.close();
				resolve(outcome);
			};
			this.#pending.add(finish);
			const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), OUTER_TIMEOUT_MS);
			channel.port1.onmessage = (e: MessageEvent<JobOutcome>) => {
				const m = e.data;
				if (!m || m.jobId !== id) return finish({ ok: false, reason: 'crashed' });
				finish(m.ok ? { ok: true, result: m.result } : { ok: false, reason: m.reason });
			};
			const ticket: JobTicket = { type: 'job', jobId: id, source: meta.source, revision: meta.revision, size: request.bytes.byteLength };
			port.postMessage(ticket, [channel.port2]);
			const input: JobInput = { jobId: id, request };
			channel.port1.postMessage(input, [request.bytes.buffer]);
		});
	}

	close(): void {
		for (const finish of [...this.#pending]) finish({ ok: false, reason: 'unavailable' });
		this.#port?.close();
		this.#port = null;
	}
}
