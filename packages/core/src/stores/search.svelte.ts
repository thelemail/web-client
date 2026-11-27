import { folderFromServer, type Message } from '$core/mail/data';
import { initialsFor } from '$core/mail/initials';
import { paletteFor } from '$core/mail/avatarPalette';
import { keystore } from '$core/keystore/keystore-client';
import type { SearchHit } from '$core/platform/types';
import { searchRuntime, searchSupported } from '$core/search/lazy';
import type { Chip } from '$core/search/chips';
import type { CoverageView, Progress } from '$core/search/coverage';
import type { ParsedQuery, QueryError, Range } from '$core/search/query/ast';
import type { ClientState, SearchClient } from '$core/search/runtime/client';
import type { SearchPrefs } from '$core/search/runtime/records';
import type { Sort } from '$core/search/sqlite/compile';
import type { RelatedView } from '$core/mail/searchView';
import type { Related, RelatedRun } from '$core/search/related.svelte';
import type { Completions, QuerySummary } from '$core/search/sqlite/run';
import type { Suggestion } from '$core/search/sqlite/suggest';
import { platform } from '$platform';
import { m } from '$paraglide/messages.js';

type Ui = typeof import('$core/search/ui');

const DEBOUNCE_MS = 180;
const DESKTOP_LIMIT = 200;
const PREVIEW_ROWS = 6;
const NO_COMPLETIONS: Completions = { terms: [], people: [] };

export type SearchPhase = 'idle' | 'starting' | 'searching' | 'ready' | 'failed' | 'locked' | 'unconverted' | 'unavailable';

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
		subj: hit.subject || m.mail_compose_no_subject(),
		labels: [],
		unread: !hit.read,
		starred: hit.starred,
		snoozedUntil: null,
		prev: hit.excerpt || hit.snippet,
		body: [],
		threadRootId: hit.threadRootId ?? undefined,
		attachments: hit.attachmentCount > 0 ? new Array(hit.attachmentCount).fill({ name: 'attachment', size: '' }) : undefined
	};
}

function ready(client: SearchClient): Promise<void> {
	return new Promise((resolve, reject) => {
		let done = false;
		let off: (() => void) | null = null;
		const finish = (error?: Error) => {
			if (done) return;
			done = true;
			queueMicrotask(() => off?.());
			if (error) reject(error);
			else resolve();
		};
		off = client.subscribe((s) => {
			if (s.phase === 'ready') finish();
			else if (s.phase === 'locked' || s.phase === 'unconverted' || s.phase === 'failed' || s.phase === 'closed') finish(new Error(s.phase));
		});
		if (done) off();
	});
}

class MailSearchStore {
	draft = $state('');
	committed = $state('');
	sort = $state<Sort>('relevance');
	exactFolders = $state(false);
	results = $state.raw<Message[]>([]);
	summary = $state.raw<QuerySummary | null>(null);
	provisional = $state.raw<{ matches: number; groups: number } | null>(null);
	searching = $state(false);
	failed = $state(false);
	loadingMore = $state(false);
	moreFailed = $state(false);
	queryError = $state.raw<QueryError | null>(null);
	preview = $state.raw<Message[]>([]);
	previewing = $state(false);
	completions = $state.raw<Completions>(NO_COMPLETIONS);
	history = $state.raw<string[]>([]);
	client = $state.raw<ClientState | null>(null);
	prefs = $state.raw<SearchPrefs | null>(null);

	#ui = $state.raw<Ui | null>(null);
	#parsed = $state.raw<ParsedQuery | null>(null);
	#loading: Promise<Ui> | null = null;
	#accountId: string | null = null;
	#queryAccount: string | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#run = 0;
	#previewRun = 0;
	#session: { id: number; client: SearchClient } | null = null;
	#pages = 0;
	#abort: AbortController | null = null;
	#related = $state.raw<RelatedRun | null>(null);
	#watching: SearchClient | null = null;
	#unwatch: (() => void) | null = null;
	#watchRun = 0;
	#attached = $state(0);

	get text(): string {
		return this.committed;
	}

	get active(): boolean {
		return this.committed.trim().length > 0;
	}

	get desktop(): boolean {
		return !!platform.mirror;
	}

	get fullSearch(): boolean {
		void this.#attached;
		return !platform.mirror && searchRuntime.fullSearch;
	}

	get mode(): 'saved' | 'preview' | 'desktop' {
		if (platform.mirror) return 'desktop';
		return this.prefs?.consent === 'saved' && this.fullSearch ? 'saved' : 'preview';
	}

	get phase(): SearchPhase {
		if (!this.active) return 'idle';
		if (this.queryError) return 'failed';
		const client = this.client?.phase;
		if (!platform.mirror && (client === 'locked' || client === 'unconverted' || client === 'failed')) return client === 'failed' ? 'unavailable' : client;
		if (this.failed) return 'failed';
		if (this.searching) return this.summary || this.provisional ? 'searching' : 'starting';
		return 'ready';
	}

	get error(): string | null {
		return this.queryError && this.#ui ? this.#ui.errorMessage(this.queryError) : null;
	}

	get errorRange(): Range | null {
		return this.queryError?.range ?? null;
	}

	get chips(): Chip[] {
		const parsed = this.#parsed;
		const ui = this.#ui;
		if (!this.active || !parsed || !ui) return [];
		return ui.chipsOf(parsed, this.committed, this.summary?.resolved ?? []);
	}

	get suggestions(): Suggestion[] {
		return this.summary?.matches === 0 ? this.summary.suggestions : [];
	}

	get coverage(): CoverageView | null {
		const ui = this.#ui;
		if (!ui || platform.mirror) return null;
		return ui.coverageOf(this.client?.status ?? null, this.summary?.dims ?? []);
	}

	get indexing(): Progress | null {
		const ui = this.#ui;
		if (!ui || platform.mirror || this.client?.phase !== 'ready') return null;
		return ui.progressOf(this.client.status);
	}

	get matches(): number | null {
		return this.summary?.matches ?? this.provisional?.matches ?? null;
	}

	get exhausted(): boolean {
		const exact = !this.summary || this.#pages >= this.summary.pages;
		return exact && (this.#related?.done ?? true);
	}

	get related(): Related | null {
		return this.#related?.state ?? null;
	}

	get relatedView(): RelatedView | null {
		return this.#related?.view(!this.summary || this.#pages >= this.summary.pages) ?? null;
	}

	retryRelated(): void {
		void this.#related?.retry();
	}

	get newAvailable(): boolean {
		const status = this.client?.status;
		return !!(this.summary && status && !this.searching && status.generation > this.summary.generation);
	}

	setAccount(accountId: string | null): void {
		if (this.#queryAccount === accountId) return;
		this.#queryAccount = accountId;
		this.#reset();
	}

	start(accountId: string): () => void {
		this.setAccount(accountId);
		this.#accountId = accountId;
		if (platform.mirror || !searchSupported()) {
			return () => {
				this.#accountId = null;
				this.setAccount(null);
			};
		}
		const offPrefs = searchRuntime.subscribePrefs((prefs) => {
			this.prefs = prefs?.accountId === accountId ? prefs : null;
		});
		const offAttach = searchRuntime.subscribeAttach(() => this.#attached++);
		const offClient = searchRuntime.subscribeClient(() => this.#watchClient());
		const offLock = keystore.subscribeAccount(accountId, (b) => {
			if (b.type === 'locked' || b.type === 'cleared' || b.type === 'clearedAll') this.#reset();
		});
		return () => {
			offPrefs();
			offAttach();
			offClient();
			offLock();
			this.#unwatchClient();
			this.#accountId = null;
			this.setAccount(null);
		};
	}

	warm(): void {
		void this.#load().catch(() => undefined);
		if (platform.mirror || !this.#accountId) return;
		void searchRuntime.focus().then(() => this.#watchClient());
	}

	#load(): Promise<Ui> {
		if (this.#ui) return Promise.resolve(this.#ui);
		this.#loading ??= import('$core/search/ui').then(
			(ui) => {
				this.#ui = ui;
				return ui;
			},
			(error) => {
				this.#loading = null;
				throw error;
			}
		);
		return this.#loading;
	}

	#watchClient(): void {
		const run = ++this.#watchRun;
		const pending = searchRuntime.client();
		if (!pending) {
			this.#unwatchClient();
			return;
		}
		void this.#load().catch(() => undefined);
		void pending.then((client) => {
			if (this.#watching === client || run !== this.#watchRun) return;
			this.#unwatchClient();
			this.#watching = client;
			this.#unwatch = client.subscribe((state) => {
				const wasReady = this.client?.status?.semantic?.state === 'ready';
				this.client = state;
				if (!wasReady && state.status?.semantic?.state === 'ready') this.#related?.modelReady();
				if (state.phase === 'ready' && this.prefs?.history && !this.history.length) void this.#loadHistory(client);
			});
		});
	}

	#unwatchClient(): void {
		this.#unwatch?.();
		this.#unwatch = null;
		this.#watching = null;
		this.client = null;
	}

	async #client(): Promise<SearchClient> {
		await searchRuntime.focus();
		this.#watchClient();
		const pending = searchRuntime.client();
		if (!pending) throw new Error('unavailable');
		const client = await pending;
		await ready(client);
		return client;
	}

	async #loadHistory(client: SearchClient): Promise<void> {
		try {
			const list = await client.history();
			if (this.#watching === client) this.history = list;
		} catch {
			this.history = [];
		}
	}

	setDraft(next: string): void {
		this.draft = next;
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#previewRun += 1;
		if (!next.trim()) {
			this.preview = [];
			this.previewing = false;
			this.completions = NO_COMPLETIONS;
			return;
		}
		this.previewing = true;
		this.#timer = setTimeout(() => void this.#executePreview(), DEBOUNCE_MS);
	}

	commit(query: string = this.draft): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#previewRun += 1;
		this.previewing = false;
		this.completions = NO_COMPLETIONS;
		this.draft = query;
		this.committed = query;
		this.failed = false;
		this.queryError = null;
		this.#parsed = null;
		this.#cancel();
		if (!query.trim()) {
			this.#run += 1;
			this.results = [];
			this.summary = null;
			this.provisional = null;
			this.searching = false;
			return;
		}
		this.searching = true;
		void this.#execute(++this.#run, query);
	}

	refresh(): void {
		if (this.active) this.commit(this.committed);
	}

	setSort(sort: Sort): void {
		if (this.sort === sort) return;
		this.sort = sort;
		this.refresh();
	}

	setExactFolders(exact: boolean): void {
		if (this.exactFolders === exact) return;
		this.exactFolders = exact;
		this.refresh();
	}

	applySuggestion(range: Range, replacement: string): void {
		const ui = this.#ui;
		if (!ui) return;
		this.commit(ui.replaceRange(this.committed, range, replacement));
	}

	removeChip(chip: Chip): void {
		const ui = this.#ui;
		if (!ui) return;
		this.commit(ui.replaceRange(this.committed, chip.range, '').replace(/\s+/g, ' ').trim());
	}

	async loadMore(): Promise<void> {
		const session = this.#session;
		const summary = this.summary;
		const run = this.#run;
		if (summary && this.#pages >= summary.pages && this.#related) return this.#loadMoreRelated(this.#related);
		if (!session || !summary || this.loadingMore || this.#pages >= summary.pages) return;
		this.loadingMore = true;
		this.moreFailed = false;
		try {
			const page = await session.client.page(session.id, this.#pages);
			if (run !== this.#run) return;
			if (!page.ok) {
				if (page.reason === 'invalidated') this.refresh();
				else this.moreFailed = true;
				return;
			}
			const ui = await this.#load();
			if (run !== this.#run) return;
			this.#pages += 1;
			this.results = [...this.results, ...page.groups.map(ui.messageFromRow)];
		} catch {
			if (run === this.#run) this.moreFailed = true;
		} finally {
			if (run === this.#run) this.loadingMore = false;
		}
	}

	async #loadMoreRelated(run: RelatedRun): Promise<void> {
		if (this.loadingMore) return;
		this.loadingMore = true;
		this.moreFailed = false;
		const result = await run.loadMore();
		if (this.#related !== run) return;
		this.loadingMore = false;
		this.moreFailed = result === 'failed';
	}

	clear(): void {
		this.setDraft('');
		this.commit('');
	}

	findResult(id: string): Message | null {
		return this.results.find((r) => r.id === id) ?? this.#related?.find(id) ?? this.preview.find((r) => r.id === id) ?? null;
	}

	patch(id: string, patch: Partial<Message>): void {
		const apply = (list: Message[]) => (list.some((r) => r.id === id) ? list.map((r) => (r.id === id ? { ...r, ...patch } : r)) : list);
		this.results = apply(this.results);
		this.preview = apply(this.preview);
		this.#related?.patch(apply);
	}

	historyMatches(prefix: string): string[] {
		const p = prefix.trim().toLowerCase();
		return this.history.filter((h) => h.toLowerCase().startsWith(p) && h !== prefix.trim());
	}

	#cancel(): void {
		this.#related?.close();
		this.#related = null;
		this.#abort?.abort();
		this.#abort = null;
		const session = this.#session;
		this.#session = null;
		this.#pages = 0;
		this.loadingMore = false;
		this.moreFailed = false;
		if (session) void session.client.closeQuery(session.id);
	}

	#reset(): void {
		if (this.#timer !== undefined) clearTimeout(this.#timer);
		this.#run += 1;
		this.#previewRun += 1;
		this.#cancel();
		this.draft = '';
		this.committed = '';
		this.results = [];
		this.summary = null;
		this.provisional = null;
		this.searching = false;
		this.failed = false;
		this.queryError = null;
		this.#parsed = null;
		this.preview = [];
		this.previewing = false;
		this.completions = NO_COMPLETIONS;
		this.history = [];
		this.exactFolders = false;
	}

	async #execute(run: number, text: string): Promise<void> {
		const accountId = this.#accountId;
		const current = () => run === this.#run && this.#accountId === accountId;
		try {
			const ui = await this.#load();
			if (!current()) return;
			if (platform.mirror) {
				const hits = accountId ? await platform.mirror.search(accountId, text.trim(), DESKTOP_LIMIT) : [];
				if (!current()) return;
				this.results = hits.map(messageFromHit);
				this.searching = false;
				return;
			}
			const parsed = ui.parse(text);
			if (!parsed.ok) {
				this.queryError = parsed.error;
				this.results = [];
				this.summary = null;
				this.searching = false;
				return;
			}
			this.#parsed = parsed.query;
			const client = await this.#client();
			if (!current()) return;
			const abort = new AbortController();
			this.#abort = abort;
			const ctx = ui.contextFor({ exactFolders: this.exactFolders, attachmentText: true });
			const reply = await client.query(parsed.query, ctx, { sort: this.sort, group: 'thread' }, abort.signal, (p) => {
				if (!current()) return;
				this.provisional = { matches: p.matches, groups: p.groups };
				if (p.rows) this.results = p.rows.map(ui.messageFromRow);
			});
			if (!current()) {
				if (reply.ok) void client.closeQuery(reply.summary.id);
				return;
			}
			if (!reply.ok) {
				if ('cancelled' in reply) return;
				this.queryError = reply.error;
				this.results = [];
				this.summary = null;
				this.searching = false;
				return;
			}
			this.#session = { id: reply.summary.id, client };
			const first = reply.summary.pages > 0 ? await client.page(reply.summary.id, 0) : { ok: true as const, groups: [] };
			if (!current()) return;
			if (!first.ok) {
				this.refresh();
				return;
			}
			this.#pages = reply.summary.pages > 0 ? 1 : 0;
			this.summary = reply.summary;
			this.provisional = null;
			this.results = first.groups.map(ui.messageFromRow);
			this.searching = false;
			if (this.#similar(ui, parsed.query, reply.summary.matches)) {
				const related: RelatedRun = new ui.RelatedRun(
					{ client, query: parsed.query, ctx, exclude: reply.summary.id, main: !reply.summary.matches, onInvalidated: () => this.#related === related && this.refresh() },
					ui.messageFromRow
				);
				this.#related = related;
				void related.start();
			}
			if (this.prefs?.history) void this.#remember(client, text);
		} catch {
			if (!current()) return;
			this.results = [];
			this.summary = null;
			this.provisional = null;
			this.failed = true;
			this.searching = false;
		}
	}

	#similar(ui: Ui, query: ParsedQuery, matches: number): boolean {
		return !!this.prefs?.semantic && this.mode === 'saved' && ui.relatedAllowed(query.eligibility, matches);
	}

	async #remember(client: SearchClient, text: string): Promise<void> {
		try {
			await client.remember(text);
			await this.#loadHistory(client);
		} catch {
			return;
		}
	}

	async #executePreview(): Promise<void> {
		const text = this.draft;
		const run = ++this.#previewRun;
		const accountId = this.#accountId;
		const current = () => run === this.#previewRun && this.#accountId === accountId;
		if (!accountId || !text.trim()) {
			this.preview = [];
			this.previewing = false;
			return;
		}
		try {
			const ui = await this.#load();
			if (!current()) return;
			if (platform.mirror) {
				const hits = await platform.mirror.search(accountId, text.trim(), PREVIEW_ROWS);
				if (!current()) return;
				this.preview = hits.map(messageFromHit);
				this.previewing = false;
				return;
			}
			const parsed = ui.parse(text);
			const client = await this.#client();
			if (!current()) return;
			const last = text.split(/\s+/).at(-1) ?? '';
			const completions = last && !last.includes(':') ? await client.complete(last).catch(() => NO_COMPLETIONS) : NO_COMPLETIONS;
			if (!current()) return;
			this.completions = completions;
			if (!parsed.ok) {
				this.preview = [];
				this.previewing = false;
				return;
			}
			const ctx = ui.contextFor({ exactFolders: this.exactFolders, attachmentText: true });
			const reply = await client.query(parsed.query, ctx, { sort: 'relevance', group: 'thread' });
			if (!reply.ok) {
				if (current()) {
					this.preview = [];
					this.previewing = false;
				}
				return;
			}
			const page = reply.summary.pages > 0 ? await client.page(reply.summary.id, 0) : null;
			if (!current()) {
				void client.closeQuery(reply.summary.id);
				return;
			}
			const exact = page?.ok ? page.groups.slice(0, PREVIEW_ROWS).map(ui.messageFromRow) : [];
			const similar = exact.length < PREVIEW_ROWS && this.#similar(ui, parsed.query, reply.summary.matches);
			this.preview = exact;
			this.previewing = similar && !exact.length;
			const rows = similar ? await ui.RelatedRun.preview({ client, query: parsed.query, ctx, exclude: reply.summary.id, main: !exact.length }, ui.messageFromRow, PREVIEW_ROWS - exact.length) : [];
			void client.closeQuery(reply.summary.id);
			if (!current() || !similar) return;
			this.preview = [...exact, ...rows];
			this.previewing = false;
		} catch {
			if (!current()) return;
			this.preview = [];
			this.previewing = false;
		}
	}
}

export const mailSearch = new MailSearchStore();
