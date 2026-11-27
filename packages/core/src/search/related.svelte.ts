import type { Message } from '$core/mail/data';
import type { RelatedView } from '$core/mail/searchView';
import type { ParsedQuery } from './query/ast';
import type { SearchClient } from './runtime/client';
import type { QueryContext } from './sqlite/compile';
import type { MeaningSummary, ResultRow } from './sqlite/run';

export type RelatedStatus = 'loading' | 'ready' | 'tooLong' | 'preparing' | 'busy' | 'failed';

export interface Related {
	status: RelatedStatus;
	main: boolean;
	rows: Message[];
	summary: MeaningSummary | null;
}

export interface RelatedRequest {
	client: SearchClient;
	query: ParsedQuery;
	ctx: QueryContext;
	exclude: number;
	main: boolean;
	onInvalidated?: () => void;
}

export type RelatedPage = 'done' | 'failed' | 'stale';

const UNAVAILABLE: Partial<Record<string, RelatedStatus>> = { tooLong: 'tooLong', busy: 'busy', model: 'preparing', empty: 'preparing' };

export class RelatedRun {
	state = $state.raw<Related | null>(null);
	#request: RelatedRequest;
	#toMessage: (row: ResultRow) => Message;
	#abort: AbortController | null = null;
	#session: number | null = null;
	#pages = 0;
	#attempt = 0;

	constructor(request: RelatedRequest, toMessage: (row: ResultRow) => Message) {
		this.#request = request;
		this.#toMessage = toMessage;
	}

	get shown(): Message[] {
		const s = this.state;
		return s && s.status === 'ready' ? s.rows : [];
	}

	static async preview(request: RelatedRequest, toMessage: (row: ResultRow) => Message, limit: number): Promise<Message[]> {
		const run = new RelatedRun(request, toMessage);
		try {
			await run.start();
			return run.shown.slice(0, limit);
		} finally {
			run.close();
		}
	}

	view(exactDone: boolean): RelatedView | null {
		const s = this.state;
		if (!s) return null;
		return { status: s.status, main: s.main, rows: exactDone ? this.shown : [], incomplete: s.summary?.incomplete ?? 0, capped: s.summary?.capped ?? 0, rebuilding: s.summary?.rebuilding ?? false };
	}

	get exhausted(): boolean {
		const s = this.state;
		return !s || s.status !== 'ready' || !s.summary || this.#pages >= s.summary.pages;
	}

	get done(): boolean {
		return this.state?.status !== 'loading' && this.exhausted;
	}

	modelReady(): void {
		if (this.state?.status === 'preparing') void this.retry();
	}

	find(id: string): Message | null {
		return this.state?.rows.find((r) => r.id === id) ?? null;
	}

	patch(apply: (rows: Message[]) => Message[]): void {
		if (this.state) this.state = { ...this.state, rows: apply(this.state.rows) };
	}

	close(): void {
		this.#attempt += 1;
		this.#abort?.abort();
		this.#abort = null;
		if (this.#session !== null) void this.#request.client.closeQuery(this.#session);
		this.#session = null;
		this.#pages = 0;
	}

	retry(): Promise<void> {
		this.close();
		return this.start();
	}

	async start(): Promise<void> {
		const attempt = ++this.#attempt;
		const { client, query, ctx, exclude, main } = this.#request;
		const abort = new AbortController();
		this.#abort = abort;
		const settle = (status: RelatedStatus, rows: Message[] = [], summary: MeaningSummary | null = null) => {
			this.state = { status, main, rows, summary };
		};
		settle('loading');
		try {
			const reply = await client.meaning(query, ctx, { group: 'thread', exclude }, abort.signal);
			if (attempt !== this.#attempt) {
				if (reply.ok) void client.closeQuery(reply.summary.id);
				return;
			}
			if (!reply.ok) {
				if ('cancelled' in reply) return;
				if ('error' in reply) settle('failed');
				else if (UNAVAILABLE[reply.unavailable]) settle(UNAVAILABLE[reply.unavailable]!);
				else this.state = null;
				return;
			}
			this.#session = reply.summary.id;
			const first = reply.summary.pages > 0 ? await client.page(reply.summary.id, 0) : { ok: true as const, groups: [] };
			if (attempt !== this.#attempt) return;
			if (!first.ok) {
				if (first.reason === 'invalidated') return this.#request.onInvalidated?.();
				settle('failed');
				return;
			}
			this.#pages = reply.summary.pages > 0 ? 1 : 0;
			settle('ready', first.groups.map(this.#toMessage), reply.summary);
		} catch {
			if (attempt === this.#attempt) settle('failed');
		}
	}

	async loadMore(): Promise<RelatedPage> {
		const attempt = this.#attempt;
		const session = this.#session;
		if (session === null || this.exhausted) return 'done';
		try {
			const page = await this.#request.client.page(session, this.#pages);
			if (attempt !== this.#attempt || !this.state) return 'stale';
			if (!page.ok) {
				if (page.reason !== 'invalidated') return 'failed';
				this.#request.onInvalidated?.();
				return 'stale';
			}
			this.#pages += 1;
			this.state = { ...this.state, rows: [...this.state.rows, ...page.groups.map(this.#toMessage)] };
			return 'done';
		} catch {
			return attempt === this.#attempt ? 'failed' : 'stale';
		}
	}
}
