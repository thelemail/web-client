import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Broadcast } from '$core/keystore/protocol';
import type { ClientState } from '$core/search/runtime/client';
import type { SearchStatus } from '$core/search/runtime/protocol';
import type { SearchPrefs } from '$core/search/runtime/records';
import type { MeaningSummary, PageResult, Provisional, QuerySummary, ResultRow } from '$core/search/sqlite/run';

const platformState = vi.hoisted(() => ({ mirror: undefined as unknown, keystoreChannel: undefined as unknown }));
vi.mock('$platform', () => ({ platform: platformState }));

const keystoreListeners = vi.hoisted(() => new Set<(b: Broadcast) => void>());
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		subscribeAccount: (_id: string, cb: (b: Broadcast) => void) => {
			keystoreListeners.add(cb);
			return () => keystoreListeners.delete(cb);
		}
	}
}));

vi.mock('$core/stores/addresses.svelte', () => ({ addresses: { items: [{ email: 'ada@calloway.test' }] } }));
vi.mock('$core/stores/mailCollections.svelte', () => ({
	mailCollections: {
		folders: [{ id: 'f1', name: 'Projects', path: 'Projects', sealed: false }],
		labels: [
			{ id: 'l1', name: 'Tax 2026', path: 'Tax 2026', sealed: false },
			{ id: 'l2', name: 'Tax 2026', path: 'Tax 2026', sealed: false }
		]
	}
}));

interface Fake {
	state: ClientState;
	listeners: Set<(s: ClientState) => void>;
	query: ReturnType<typeof vi.fn>;
	meaning: ReturnType<typeof vi.fn>;
	page: ReturnType<typeof vi.fn>;
	closeQuery: ReturnType<typeof vi.fn>;
	complete: ReturnType<typeof vi.fn>;
	history: ReturnType<typeof vi.fn>;
	remember: ReturnType<typeof vi.fn>;
	set(next: Partial<ClientState>): void;
}

const runtime = vi.hoisted(() => ({
	prefs: null as SearchPrefs | null,
	prefListeners: new Set<(p: SearchPrefs | null) => void>(),
	clientListeners: new Set<() => void>(),
	client: null as unknown,
	focus: null as unknown as ReturnType<typeof vi.fn>,
	full: false
}));

vi.mock('$core/search/lazy', () => ({
	searchSupported: () => !platformState.mirror,
	searchRuntime: {
		get fullSearch() {
			return runtime.full;
		},
		focus: (...a: unknown[]) => runtime.focus(...a),
		client: () => (runtime.client ? Promise.resolve(runtime.client) : null),
		subscribeAttach: () => () => {},
		subscribeClient: (cb: () => void) => {
			runtime.clientListeners.add(cb);
			cb();
			return () => runtime.clientListeners.delete(cb);
		},
		subscribePrefs: (cb: (p: SearchPrefs | null) => void) => {
			runtime.prefListeners.add(cb);
			cb(runtime.prefs);
			return () => runtime.prefListeners.delete(cb);
		}
	}
}));

import { mailSearch } from './search.svelte';

function status(over: Partial<SearchStatus> = {}): SearchStatus {
	return { persistence: 'persistent', mode: 'saved', limited: null, sources: 10, working: null, paused: false, generation: 0, sync: null, ...over };
}

function fake(): Fake {
	const f: Fake = {
		state: { phase: 'ready', role: 'owner', status: status() },
		listeners: new Set(),
		query: vi.fn(),
		meaning: vi.fn(),
		page: vi.fn(),
		closeQuery: vi.fn(async () => {}),
		complete: vi.fn(async () => ({ terms: [], people: [] })),
		history: vi.fn(async () => []),
		remember: vi.fn(async () => {}),
		set(next) {
			f.state = { ...f.state, ...next };
			for (const l of f.listeners) l(f.state);
		}
	};
	return f;
}

let client: Fake;

function asClient(f: Fake) {
	return {
		subscribe: (l: (s: ClientState) => void) => {
			f.listeners.add(l);
			l(f.state);
			return () => f.listeners.delete(l);
		},
		query: (...a: unknown[]) => f.query(...a),
		meaning: (...a: unknown[]) => f.meaning(...a),
		page: (...a: unknown[]) => f.page(...a),
		closeQuery: (...a: unknown[]) => f.closeQuery(...a),
		complete: (...a: unknown[]) => f.complete(...a),
		history: () => f.history(),
		remember: (...a: unknown[]) => f.remember(...a)
	};
}

function row(id: string, over: Partial<ResultRow> = {}): ResultRow {
	return {
		key: `t${id}`,
		threadId: `t${id}`,
		matches: 1,
		exact: false,
		score: 1,
		date: 1_700_000_000_000,
		best: { kind: 1, sourceId: id },
		sources: [{ kind: 1, sourceId: id }],
		subject: 'Permission slip',
		subjectSpans: [{ start: 0, end: 10 }],
		from: { name: 'Anna', address: 'anna@school.pt' },
		to: [{ name: '', address: 'ada@calloway.test' }],
		flags: 1 | (1 << 3),
		knownFlags: 0x1ff,
		attachments: 0,
		folders: [],
		labels: [],
		excerpt: { text: 'please sign the permission slip', spans: [{ start: 16, end: 26 }], field: 3, attachmentId: null, locator: null, place: null, clippedStart: false, clippedEnd: false },
		filename: null,
		fields: [1, 3],
		...over
	};
}

function summary(over: Partial<QuerySummary> = {}): QuerySummary {
	return { id: 1, matches: 1, groups: 1, pages: 1, incomplete: 0, excluded: 0, suggestions: [], generation: 0, dims: [1, 2], resolved: [], ...over };
}

function answers(rows: ResultRow[], over: Partial<QuerySummary> = {}) {
	const s = summary({ matches: rows.length, groups: rows.length, pages: rows.length ? 1 : 0, ...over });
	client.query.mockResolvedValue({ ok: true, summary: s });
	client.page.mockResolvedValue({ ok: true, groups: rows } satisfies PageResult);
	return s;
}

function prefs(over: Partial<SearchPrefs> = {}) {
	runtime.prefs = { accountId: 'acc-1', consent: 'saved', paused: false, history: false, ...over };
	for (const l of runtime.prefListeners) l(runtime.prefs);
}

let stop: (() => void) | null = null;

beforeAll(async () => {
	mailSearch.warm();
	await vi.dynamicImportSettled();
});

beforeEach(() => {
	platformState.mirror = undefined;
	client = fake();
	runtime.client = asClient(client);
	runtime.focus = vi.fn(async () => {});
	runtime.full = false;
	runtime.prefs = { accountId: 'acc-1', consent: 'saved', paused: false, history: false };
	vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))));
	stop = mailSearch.start('acc-1');
	mailSearch.clear();
});

afterEach(() => {
	stop?.();
	stop = null;
	mailSearch.setSort('relevance');
	vi.unstubAllGlobals();
});

describe('mailSearch on the local index', () => {
	it('runs a committed query on this device and shows highlighted rows', async () => {
		answers([row('m1')]);
		mailSearch.commit('permission');
		expect(mailSearch.searching).toBe(true);
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		const r = mailSearch.results[0];
		expect(r).toMatchObject({ id: 'm1', subj: 'Permission slip', folder: 'archive', unread: false, from: 'Anna' });
		expect(r.match).toMatchObject({ kind: 'message', excerpt: 'please sign the permission slip', excerptSpans: [{ start: 16, end: 26 }] });
		expect(client.query.mock.calls[0][1]).toMatchObject({ identities: ['ada@calloway.test'] });
		expect(client.query.mock.calls[0][2]).toEqual({ sort: 'relevance', group: 'thread' });
		expect(fetch).not.toHaveBeenCalled();
		expect(mailSearch.phase).toBe('ready');
	});

	it('shows the provisional first page before the final count', async () => {
		let finish: (v: unknown) => void = () => {};
		client.query.mockImplementation((_q, _c, _o, _s, onProgress: (p: Provisional) => void) => {
			onProgress({ matches: 60, groups: 50, rows: [row('early')] });
			return new Promise((r) => (finish = r));
		});
		client.page.mockResolvedValue({ ok: true, groups: [row('final')] });
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.results.map((r) => r.id)).toEqual(['early']));
		expect(mailSearch.provisional).toEqual({ matches: 60, groups: 50 });
		expect(mailSearch.phase).toBe('searching');
		finish({ ok: true, summary: summary({ matches: 120, groups: 90, pages: 2 }) });
		await vi.waitFor(() => expect(mailSearch.results.map((r) => r.id)).toEqual(['final']));
		expect(mailSearch.matches).toBe(120);
		expect(mailSearch.exhausted).toBe(false);
	});

	it('maps drafts and scheduled sends to their own kind', async () => {
		answers([row('d1', { best: { kind: 2, sourceId: 'd1' }, flags: 0 }), row('s1', { best: { kind: 3, sourceId: 's1' }, flags: 0 })]);
		mailSearch.commit('lunch');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(2));
		expect(mailSearch.results.map((r) => [r.match?.kind, r.folder, r.unread])).toEqual([
			['draft', 'drafts', false],
			['scheduled', 'scheduled', false]
		]);
	});

	it('reports a syntax error with its range and runs nothing', async () => {
		mailSearch.commit('from:x "open');
		await vi.waitFor(() => expect(mailSearch.error).not.toBeNull());
		expect(mailSearch.errorRange).toMatchObject({ start: 7 });
		expect(mailSearch.phase).toBe('failed');
		expect(client.query).not.toHaveBeenCalled();
	});

	it('reports an unknown label the compiler could not resolve', async () => {
		client.query.mockResolvedValue({ ok: false, error: { code: 'unknown_label', range: { start: 0, end: 10 }, name: 'nope' } });
		mailSearch.commit('label:nope');
		await vi.waitFor(() => expect(mailSearch.queryError).toMatchObject({ code: 'unknown_label' }));
		expect(mailSearch.results).toEqual([]);
	});

	it('drops results from a query the user has moved on from', async () => {
		let first: (v: unknown) => void = () => {};
		client.query.mockImplementationOnce(() => new Promise((r) => (first = r)));
		mailSearch.commit('stale');
		await vi.waitFor(() => expect(client.query).toHaveBeenCalledTimes(1));
		answers([row('fresh')]);
		mailSearch.commit('fresh');
		await vi.waitFor(() => expect(mailSearch.results.map((r) => r.id)).toEqual(['fresh']));
		first({ ok: true, summary: summary({ id: 9 }) });
		await vi.waitFor(() => expect(client.closeQuery).toHaveBeenCalledWith(9));
		expect(mailSearch.results.map((r) => r.id)).toEqual(['fresh']);
	});

	it('re-runs with the chosen order and exact folders', async () => {
		answers([row('m1')]);
		mailSearch.commit('in:Projects');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		mailSearch.setSort('oldest');
		await vi.waitFor(() => expect(client.query).toHaveBeenCalledTimes(2));
		expect(client.query.mock.calls[1][2]).toEqual({ sort: 'oldest', group: 'thread' });
		mailSearch.setExactFolders(true);
		await vi.waitFor(() => expect(client.query).toHaveBeenCalledTimes(3));
		expect(client.query.mock.calls[2][1]).toMatchObject({ exactFolders: true });
		mailSearch.setExactFolders(false);
	});

	it('loads the next page of the same session', async () => {
		answers([row('m1')], { pages: 2, groups: 2, matches: 2 });
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		client.page.mockResolvedValueOnce({ ok: true, groups: [row('m2')] });
		await mailSearch.loadMore();
		expect(client.page).toHaveBeenLastCalledWith(1, 1);
		expect(mailSearch.results.map((r) => r.id)).toEqual(['m1', 'm2']);
		expect(mailSearch.exhausted).toBe(true);
	});

	it('runs the query again when a deletion invalidates the pages', async () => {
		answers([row('m1')], { pages: 2 });
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		client.page.mockResolvedValueOnce({ ok: false, reason: 'invalidated' });
		await mailSearch.loadMore();
		await vi.waitFor(() => expect(client.query).toHaveBeenCalledTimes(2));
	});

	it('announces new mail without replacing the pinned results', async () => {
		answers([row('m1')], { generation: 3 });
		mailSearch.warm();
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		expect(mailSearch.newAvailable).toBe(false);
		client.set({ status: status({ generation: 4 }) });
		await vi.waitFor(() => expect(mailSearch.newAvailable).toBe(true));
		expect(client.query).toHaveBeenCalledTimes(1);
	});

	it('names each filter as a chip and flags a shared label name', async () => {
		answers([], { resolved: [{ kind: 'label', name: 'Tax 2026', range: { start: 8, end: 24 }, ids: ['l1', 'l2'], descendants: 0 }] });
		mailSearch.commit('invoice label:"Tax 2026" -in:sent subject:x');
		await vi.waitFor(() => expect(mailSearch.summary).not.toBeNull());
		expect(mailSearch.chips.map((c) => [c.text, c.kind, c.negated, c.matches])).toEqual([
			['label:"Tax 2026"', 'label', false, 2],
			['-in:sent', 'scope', true, 0],
			['subject:x', 'filter', false, 0]
		]);
	});

	it('applies a spelling suggestion by replacing only that word', async () => {
		answers([], { suggestions: [{ range: { start: 5, end: 11 }, original: 'invoce', replacement: 'invoice' }] });
		mailSearch.commit('from:invoce');
		await vi.waitFor(() => expect(mailSearch.suggestions).toHaveLength(1));
		answers([row('m1')]);
		mailSearch.applySuggestion(mailSearch.suggestions[0].range, 'invoice');
		expect(mailSearch.committed).toBe('from:invoice');
	});

	it('says search is locked when the vault is', async () => {
		client.set({ phase: 'locked', role: null, status: null });
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.phase).toBe('locked'));
		expect(mailSearch.results).toEqual([]);
	});

	it('tells an account that has not finished converting apart from a locked one', async () => {
		client.set({ phase: 'unconverted', role: null, status: null });
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.phase).toBe('unconverted'));
		expect(mailSearch.results).toEqual([]);
	});

	it('drops earlier rows when the device can no longer search', async () => {
		answers([row('m1')]);
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		client.set({ phase: 'failed', status: null });
		mailSearch.refresh();
		await vi.waitFor(() => expect(mailSearch.searching).toBe(false));
		expect(mailSearch.phase).toBe('unavailable');
		expect(mailSearch.results).toEqual([]);
		expect(mailSearch.summary).toBeNull();
	});

	it('reports indexing progress from a client that started at idle, without a search', async () => {
		stop?.();
		runtime.client = null;
		stop = mailSearch.start('acc-1');
		expect(mailSearch.indexing).toBeNull();
		client.state = {
			phase: 'ready',
			role: 'owner',
			status: status({
				sync: {
					phase: 'live',
					seq: 1,
					syncedAt: 1,
					waiting: null,
					queue: { total: 10, undescribed: 0, held: 0, waiting: 0, bodies: {} },
					coverage: [
						{ dimension: 2, state: 2, count: 4 },
						{ dimension: 2, state: 0, count: 6 }
					]
				}
			})
		};
		runtime.client = asClient(client);
		for (const l of runtime.clientListeners) l();
		await vi.waitFor(() => expect(mailSearch.indexing).toEqual({ state: 'reading', done: 4, total: 10, fraction: 0.4 }));
		runtime.client = null;
		for (const l of runtime.clientListeners) l();
		expect(mailSearch.indexing).toBeNull();
	});

	it('clears query and results on lock and on account switch', async () => {
		answers([row('m1')]);
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		for (const l of keystoreListeners) l({ type: 'locked', accountId: 'acc-1' } as Broadcast);
		expect(mailSearch.committed).toBe('');
		expect(mailSearch.results).toEqual([]);
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		mailSearch.setAccount('acc-2');
		expect(mailSearch.committed).toBe('');
		expect(mailSearch.draft).toBe('');
		expect(mailSearch.results).toEqual([]);
	});

	it('remembers a query only when history is on', async () => {
		answers([row('m1')]);
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		expect(client.remember).not.toHaveBeenCalled();
		prefs({ history: true });
		client.history.mockResolvedValue(['budget 2026']);
		mailSearch.commit('budget 2026');
		await vi.waitFor(() => expect(client.remember).toHaveBeenCalledWith('budget 2026'));
		await vi.waitFor(() => expect(mailSearch.history).toEqual(['budget 2026']));
		prefs({ history: false });
	});

	it('suggests words and people while typing, debounced', async () => {
		vi.useFakeTimers();
		try {
			client.complete.mockResolvedValue({ terms: ['invoice'], people: [{ name: 'Inês', address: 'ines@example.com' }] });
			answers([row('m1')]);
			mailSearch.setDraft('i');
			mailSearch.setDraft('in');
			mailSearch.setDraft('inv');
			expect(client.complete).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(200);
			await vi.waitFor(() => expect(mailSearch.completions.terms).toEqual(['invoice']));
			expect(client.complete).toHaveBeenCalledTimes(1);
			expect(client.complete).toHaveBeenCalledWith('inv');
			await vi.waitFor(() => expect(mailSearch.preview).toHaveLength(1));
			expect(mailSearch.committed).toBe('');
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('mailSearch on the desktop build', () => {
	beforeEach(() => {
		stop?.();
	});

	it('renders mirror hits and forwards the text untouched', async () => {
		const search = vi.fn(async () => [
			{
				id: 'deep',
				subject: 'Permission slip',
				senderDisplay: 'Anna',
				senderAddress: 'anna@school.pt',
				snippet: 'please sign',
				excerpt: 'please sign',
				storedAt: '2024-01-01T00:00:00Z',
				mailboxState: 'archive',
				direction: 'sent',
				read: true,
				starred: false,
				attachmentCount: 0,
				threadRootId: null
			}
		]);
		platformState.mirror = { search };
		stop = mailSearch.start('acc-1');
		mailSearch.commit('invoice from:anna is:unread');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		expect(search).toHaveBeenCalledWith('acc-1', 'invoice from:anna is:unread', 200);
		expect(mailSearch.results[0]).toMatchObject({ id: 'deep', folder: 'archive', direction: 'sent' });
		expect(client.query).not.toHaveBeenCalled();
		expect(mailSearch.mode).toBe('desktop');
	});
});

describe('mailSearch related results', () => {
	function meaningSummary(over: Partial<MeaningSummary> = {}): MeaningSummary {
		return { id: 7, groups: 1, pages: 1, eligible: 10, incomplete: 0, capped: 0, scanned: 10, rebuilding: false, generation: 0, resolved: [], ...over };
	}

	function exactThenRelated(exact: ResultRow[], related: ResultRow[]) {
		client.query.mockResolvedValue({ ok: true, summary: summary({ id: 1, matches: exact.length, groups: exact.length, pages: exact.length ? 1 : 0 }) });
		client.page.mockImplementation(async (id: number) => ({ ok: true, groups: id === 7 ? related : exact }));
	}

	beforeEach(() => {
		runtime.full = true;
		prefs({ semantic: true });
	});

	it('shows exact results while the model is still working, then related ones below', async () => {
		exactThenRelated([row('e1')], [row('r1', { channel: 'meaning', passage: { field: 3, attachmentId: null, place: null, text: 'O voo foi cancelado' } })]);
		const pending = Promise.withResolvers<unknown>();
		client.meaning.mockReturnValue(pending.promise);
		mailSearch.commit('flight refund');
		await vi.waitFor(() => expect(mailSearch.results.map((r) => r.id)).toEqual(['e1']));
		expect(mailSearch.searching).toBe(false);
		expect(mailSearch.related?.status).toBe('loading');
		expect(client.meaning.mock.calls[0][2]).toEqual({ group: 'thread', exclude: 1 });
		pending.resolve({ ok: true, summary: meaningSummary() });
		await vi.waitFor(() => expect(mailSearch.related?.status).toBe('ready'));
		const hit = mailSearch.relatedShown[0];
		expect(hit.match).toMatchObject({ channel: 'meaning', excerpt: 'O voo foi cancelado', excerptSpans: [] });
		expect(mailSearch.related?.main).toBe(false);
		expect(mailSearch.matches).toBe(1);
		expect(mailSearch.findResult('r1')?.id).toBe('r1');
	});

	it('pages related rows in after the last exact page', async () => {
		exactThenRelated([row('e1')], [row('r1', { channel: 'both' })]);
		client.meaning.mockResolvedValue({ ok: true, summary: meaningSummary({ groups: 60, pages: 2 }) });
		mailSearch.commit('flight refund');
		await vi.waitFor(() => expect(mailSearch.related?.status).toBe('ready'));
		expect(mailSearch.exactExhausted).toBe(true);
		expect(mailSearch.relatedShown.map((r) => r.id)).toEqual(['r1']);
		expect(mailSearch.exhausted).toBe(false);
		await mailSearch.loadMore();
		expect(client.page).toHaveBeenLastCalledWith(7, 1);
		expect(mailSearch.exhausted).toBe(true);
	});

	it('fills the popup with similar mail after the exact previews', async () => {
		exactThenRelated([row('e1')], [row('r1', { channel: 'meaning' }), row('r2', { channel: 'meaning' })]);
		client.meaning.mockResolvedValue({ ok: true, summary: meaningSummary() });
		mailSearch.setDraft('flight refund');
		await vi.waitFor(() => expect(mailSearch.preview.map((r) => r.id)).toEqual(['e1', 'r1', 'r2']));
		expect(mailSearch.previewing).toBe(false);
		expect(mailSearch.preview[1].match?.channel).toBe('meaning');
		await vi.waitFor(() => expect(client.closeQuery).toHaveBeenCalledWith(1));
		expect(client.closeQuery).toHaveBeenCalledWith(7);
	});

	it('makes related results the main list when nothing matches exactly, and pages them', async () => {
		exactThenRelated([], [row('r1', { channel: 'meaning' })]);
		client.meaning.mockResolvedValue({ ok: true, summary: meaningSummary({ groups: 60, pages: 2 }) });
		mailSearch.commit('refund');
		await vi.waitFor(() => expect(mailSearch.related?.status).toBe('ready'));
		expect(mailSearch.related?.main).toBe(true);
		expect(mailSearch.exhausted).toBe(false);
		await mailSearch.loadMore();
		expect(client.page).toHaveBeenLastCalledWith(7, 1);
		expect(mailSearch.related?.rows).toHaveLength(2);
		expect(mailSearch.exhausted).toBe(true);
	});

	it('does not expand a single word that already matches', async () => {
		exactThenRelated([row('e1')], []);
		mailSearch.commit('refund');
		await vi.waitFor(() => expect(mailSearch.results).toHaveLength(1));
		expect(client.meaning).not.toHaveBeenCalled();
		expect(mailSearch.related).toBeNull();
	});

	it.each(['"AB-1047"', '+INV-2026-0042', 'alice@example.com', 'a OR b'])('never expands %s', async (input) => {
		exactThenRelated([], []);
		mailSearch.commit(input);
		await vi.waitFor(() => expect(mailSearch.phase).toBe('ready'));
		expect(client.meaning).not.toHaveBeenCalled();
	});

	it('stays off until meaning search is turned on', async () => {
		prefs({ semantic: false });
		exactThenRelated([], []);
		mailSearch.commit('flight refund');
		await vi.waitFor(() => expect(mailSearch.phase).toBe('ready'));
		expect(client.meaning).not.toHaveBeenCalled();
	});

	it('cancels related work on a new search and drops its late answer', async () => {
		exactThenRelated([row('e1')], [row('late', { channel: 'meaning' })]);
		const pending = Promise.withResolvers<unknown>();
		client.meaning.mockReturnValueOnce(pending.promise);
		mailSearch.commit('flight refund');
		await vi.waitFor(() => expect(mailSearch.related?.status).toBe('loading'));
		const signal = client.meaning.mock.calls[0][3] as AbortSignal;
		client.meaning.mockResolvedValue({ ok: false, unavailable: 'busy' });
		mailSearch.commit('hotel invoice');
		expect(signal.aborted).toBe(true);
		pending.resolve({ ok: true, summary: meaningSummary({ id: 9 }) });
		await vi.waitFor(() => expect(mailSearch.related?.status).toBe('busy'));
		expect(client.closeQuery).toHaveBeenCalledWith(9);
	});

	it.each([
		['tooLong', 'tooLong'],
		['model', 'preparing'],
		['empty', 'preparing'],
		['busy', 'busy']
	] as const)('shows %s from the worker as %s and leaves exact results alone', async (unavailable, shown) => {
		exactThenRelated([row('e1')], []);
		client.meaning.mockResolvedValue({ ok: false, unavailable });
		mailSearch.commit('flight refund');
		await vi.waitFor(() => expect(mailSearch.related?.status).toBe(shown));
		expect(mailSearch.results.map((r) => r.id)).toEqual(['e1']);
		expect(mailSearch.phase).toBe('ready');
	});

	it('tries again once the model is ready', async () => {
		exactThenRelated([row('e1')], [row('r1', { channel: 'meaning' })]);
		client.meaning.mockResolvedValueOnce({ ok: false, unavailable: 'model' });
		client.set({ status: status({ semantic: { state: 'loading' } }) });
		mailSearch.commit('flight refund');
		await vi.waitFor(() => expect(mailSearch.related?.status).toBe('preparing'));
		client.meaning.mockResolvedValue({ ok: true, summary: meaningSummary() });
		client.set({ status: status({ semantic: { state: 'ready' } }) });
		await vi.waitFor(() => expect(mailSearch.related?.status).toBe('ready'));
		expect(client.meaning).toHaveBeenCalledTimes(2);
	});

	it('retries after a failure', async () => {
		exactThenRelated([row('e1')], [row('r1', { channel: 'words' })]);
		client.meaning.mockRejectedValueOnce(new Error('boom'));
		mailSearch.commit('flight refund');
		await vi.waitFor(() => expect(mailSearch.related?.status).toBe('failed'));
		client.meaning.mockResolvedValue({ ok: true, summary: meaningSummary() });
		mailSearch.retryRelated();
		await vi.waitFor(() => expect(mailSearch.related?.status).toBe('ready'));
	});
});
