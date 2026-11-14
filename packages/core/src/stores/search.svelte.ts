import { folderFromServer, type Message } from '$core/mail/data';
import { initialsFor } from '$core/mail/initials';
import { paletteFor } from '$core/mail/avatarPalette';
import type { ParsedQuery, QueryError } from '$core/search/query/ast';
import type { SearchHit } from '$core/platform/types';
import { platform } from '$platform';
import { m } from '$paraglide/messages.js';

type Engine = typeof import('./searchEngine');

const DEBOUNCE_MS = 180;
const MIRROR_LIMIT = 200;
const PREVIEW_LIMIT = 6;
const IDLE_TIMEOUT_MS = 5000;
const IDLE_FALLBACK_MS = 3000;

interface Found {
	messages: Message[];
	error: QueryError | null;
}

function whenIdle(work: () => void): () => void {
	if (typeof requestIdleCallback === 'function') {
		const handle = requestIdleCallback(work, { timeout: IDLE_TIMEOUT_MS });
		return () => cancelIdleCallback(handle);
	}
	const timer = setTimeout(work, IDLE_FALLBACK_MS);
	return () => clearTimeout(timer);
}

function messageFromHit(hit: SearchHit): Message {
	const display = hit.senderDisplay || hit.senderAddress || m.mailbox_unknown_sender();
	const palette = paletteFor(hit.senderAddress.toLowerCase());
	const storedAt = new Date(hit.storedAt).getTime();
	const state = hit.mailboxState as 'inbox' | 'archive' | 'folder' | 'trash' | 'spam' | 'snoozed';
	const direction = hit.direction ?? 'received';
	return {
		id: hit.id,
		folder: folderFromServer(state, direction, hit.folderId),
		direction,
		from: display,
		fromAddr: hit.senderAddress,
		to: '',
		recipients: [],
		init: initialsFor(display, hit.senderAddress),
		bg: palette.bg,
		fg: palette.fg,
		epoch: Number.isNaN(storedAt) ? 0 : storedAt,
		subj: hit.subject || '(no subject)',
		labels: [],
		unread: !hit.read,
		starred: hit.starred,
		snoozedUntil: null,
		prev: hit.excerpt || hit.snippet,
		body: [],
		threadRootId: hit.threadRootId ?? undefined,
		attachments:
			hit.attachmentCount > 0
				? new Array(hit.attachmentCount).fill({ name: 'attachment', size: '' })
				: undefined
	};
}

class MailSearchStore {
	draft = $state('');
	committed = $state('');
	results = $state<Message[]>([]);
	searching = $state(false);
	failed = $state(false);
	preview = $state<Message[]>([]);
	previewing = $state(false);
	indexed = $state(0);
	indexing = $state(false);
	complete = $state(false);
	queryError = $state<QueryError | null>(null);

	#query = $state.raw<ParsedQuery | null>(null);
	#engine = $state.raw<Engine | null>(null);
	#loading: Promise<Engine> | null = null;
	#accountId: string | null = null;
	#queryAccount: string | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#run = 0;
	#previewRun = 0;
	#unsubscribe: (() => void) | null = null;

	get text(): string {
		return this.committed;
	}

	get active(): boolean {
		return this.committed.trim().length > 0;
	}

	get partial(): boolean {
		return this.active && !this.complete && !platform.mirror;
	}

	get error(): string | null {
		return this.queryError && this.#engine ? this.#engine.errorMessage(this.queryError) : null;
	}

	get chips(): string[] {
		const query = this.#query;
		if (!this.active || !query || !this.#engine) return [];
		return this.#engine.chipsOf(query, this.committed);
	}

	setAccount(accountId: string | null): void {
		if (this.#queryAccount === accountId) return;
		this.#queryAccount = accountId;
		this.#reset();
	}

	start(accountId: string): () => void {
		this.setAccount(accountId);
		this.#accountId = accountId;
		this.#unsubscribe?.();
		this.indexed = 0;
		this.complete = false;
		if (platform.mirror) {
			return () => {
				this.#accountId = null;
				this.setAccount(null);
			};
		}
		const cancelIdle = whenIdle(() => this.warm());
		if (this.#engine) this.#follow(this.#engine, accountId);
		return () => {
			cancelIdle();
			this.#unsubscribe?.();
			this.#unsubscribe = null;
			this.#accountId = null;
			this.setAccount(null);
			this.#engine?.close();
		};
	}

	warm(): void {
		void this.#load().catch(() => undefined);
	}

	#load(): Promise<Engine> {
		if (this.#engine) return Promise.resolve(this.#engine);
		this.#loading ??= import('./searchEngine').then(
			(engine) => {
				this.#engine = engine;
				if (this.#accountId && !platform.mirror) this.#follow(engine, this.#accountId);
				return engine;
			},
			(error) => {
				this.#loading = null;
				throw error;
			}
		);
		return this.#loading;
	}

	#follow(engine: Engine, accountId: string): void {
		this.#unsubscribe?.();
		this.#unsubscribe = engine.subscribe((progress) => {
			if (this.#accountId !== accountId) return;
			this.indexed = progress.indexed;
			this.complete = progress.complete;
			if (this.active) this.#execute();
			if (this.draft.trim()) this.#executePreview();
		});
		void this.refresh();
	}

	async refresh(): Promise<void> {
		const accountId = this.#accountId;
		const engine = this.#engine;
		if (!accountId || platform.mirror || !engine) return;
		this.indexing = true;
		try {
			await engine.sync(accountId);
		} catch {
			this.complete = false;
		} finally {
			if (this.#accountId === accountId) this.indexing = false;
		}
	}

	setDraft(next: string): void {
		this.draft = next;
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#previewRun += 1;
		if (!next.trim()) {
			this.preview = [];
			this.previewing = false;
			return;
		}
		this.previewing = true;
		this.#timer = setTimeout(() => this.#executePreview(), DEBOUNCE_MS);
	}

	commit(query: string = this.draft): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#previewRun += 1;
		this.previewing = false;
		this.draft = query;
		this.committed = query;
		this.failed = false;
		this.queryError = null;
		this.#query = null;
		if (!query.trim()) {
			this.#run += 1;
			this.results = [];
			this.searching = false;
			return;
		}
		this.searching = true;
		const run = ++this.#run;
		const engine = this.#engine;
		if (engine) {
			this.#begin(engine, query);
			return;
		}
		this.#load().then(
			(loaded) => {
				if (run === this.#run) this.#begin(loaded, query);
			},
			() => {
				if (run !== this.#run) return;
				this.failed = true;
				this.searching = false;
			}
		);
	}

	#begin(engine: Engine, query: string): void {
		const parsed = engine.parse(query);
		if (parsed.ok) this.#query = parsed.query;
		else if (!platform.mirror) this.queryError = parsed.error;
		this.#execute();
	}

	setText(next: string): void {
		this.commit(next);
	}

	clear(): void {
		this.setDraft('');
		this.commit('');
	}

	findResult(id: string): Message | null {
		return this.results.find((m) => m.id === id) ?? this.preview.find((m) => m.id === id) ?? null;
	}

	patch(id: string, patch: Partial<Message>): void {
		const apply = (list: Message[]) =>
			list.some((m) => m.id === id) ? list.map((m) => (m.id === id ? { ...m, ...patch } : m)) : list;
		this.results = apply(this.results);
		this.preview = apply(this.preview);
	}

	#reset(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#run += 1;
		this.#previewRun += 1;
		this.draft = '';
		this.committed = '';
		this.results = [];
		this.searching = false;
		this.failed = false;
		this.queryError = null;
		this.#query = null;
		this.preview = [];
		this.previewing = false;
		this.indexed = 0;
		this.complete = false;
	}

	async #search(text: string, query: ParsedQuery | null, limit: number): Promise<Found> {
		const accountId = this.#accountId;
		const mirror = platform.mirror;
		if (!accountId) return { messages: [], error: null };
		if (mirror) {
			const hits = await mirror.search(accountId, text.trim(), limit);
			return { messages: hits.map(messageFromHit), error: null };
		}
		if (!query) return { messages: [], error: null };
		return (await this.#load()).find(query, limit);
	}

	#execute(): void {
		const text = this.committed;
		if (!this.#accountId || !text.trim() || (!platform.mirror && !this.#query)) {
			this.results = [];
			this.searching = false;
			return;
		}
		const run = ++this.#run;
		void this.#search(text, this.#query, MIRROR_LIMIT).then(
			(found) => {
				if (run !== this.#run) return;
				this.results = found.messages;
				this.queryError = found.error;
				this.failed = false;
				this.searching = false;
			},
			() => {
				if (run !== this.#run) return;
				this.failed = true;
				this.searching = false;
			}
		);
	}

	#executePreview(): void {
		const text = this.draft;
		const engine = this.#engine;
		if (!engine) {
			if (!this.#accountId || !text.trim()) {
				this.preview = [];
				this.previewing = false;
				return;
			}
			const waiting = ++this.#previewRun;
			this.#load().then(
				() => {
					if (waiting === this.#previewRun) this.#executePreview();
				},
				() => {
					if (waiting !== this.#previewRun) return;
					this.preview = [];
					this.previewing = false;
				}
			);
			return;
		}
		const parsed = text.trim() ? engine.parse(text) : null;
		if (!this.#accountId || !parsed || (!parsed.ok && !platform.mirror)) {
			this.preview = [];
			this.previewing = false;
			return;
		}
		const run = ++this.#previewRun;
		void this.#search(text, parsed.ok ? parsed.query : null, PREVIEW_LIMIT).then(
			(found) => {
				if (run !== this.#previewRun) return;
				this.preview = found.messages;
				this.previewing = false;
			},
			() => {
				if (run !== this.#previewRun) return;
				this.preview = [];
				this.previewing = false;
			}
		);
	}
}

export const mailSearch = new MailSearchStore();
