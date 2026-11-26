import type { OpenSearchRootResponse } from '$core/keystore/protocol';
import type { GenerationResult } from '../../api/searchSync';
import type { SearchSyncState } from '../../api/types';
import { resolveSync } from '../artifacts/generation';
import type { BridgeHooks } from '../sync/serve';
import type { ParsedQuery } from '../query/ast';
import type { QueryContext } from '../sqlite/compile';
import type { Completions, PageResult, Provisional } from '../sqlite/run';
import type { BrokerEvent, BrokerRequest } from './broker.worker';
import { contend, lockName, type Contest, type Tenure } from './owner';
import {
	directoryFor,
	type ClientMessage,
	type ClientRequest,
	type ControlRequest,
	type CloudState,
	type InitResult,
	type Mode,
	type MeaningReply,
	type MeaningRequestOptions,
	type QueryReply,
	type QueryRequestOptions,
	type Reply,
	type SearchStatus,
	type WorkerEvent
} from './protocol';
import type { PrefStore, RecordStore, SearchRecord } from './records';
import type { Conditions } from './scheduler';

const CONNECT_TIMEOUT_MS = 3000;
const PING_EVERY_MS = 5000;
const PING_TIMEOUT_MS = 5000;
const RETRY_MS = 1000;
const CLAIM_EVERY_MS = 5000;
const STEAL_AFTER_MS = 10_000;
const CLOSE_TIMEOUT_MS = 2000;
const SALT_BYTES = 32;
const MAX_CRASHES = 3;
const RESYNC_RETRY_MS = 60_000;

export type Phase = 'starting' | 'ready' | 'locked' | 'unconverted' | 'failed' | 'closed';
export type Role = 'owner' | 'follower';

export interface ClientState {
	phase: Phase;
	role: Role | null;
	status: SearchStatus | null;
}

export interface ClientDeps {
	spawn(): Worker;
	spawnModel?(): Worker;
	broker(): MessagePort | null;
	openRoot(args: { accountId: string; bundle?: Uint8Array }, port: MessagePort): Promise<OpenSearchRootResponse>;
	records: RecordStore;
	prefs: PrefStore;
	locks: LockManager | null;
	watch(report: (conditions: Conditions) => void): () => void;
	serveBridge?(accountId: string, port: MessagePort, hooks?: BridgeHooks): () => void;
	parser?(): MessagePort | null;
	cloud?: CloudApi;
}

export interface CloudApi {
	state(accountId: string): Promise<SearchSyncState>;
	create(accountId: string, body: { generationId: string; productKeyEpoch: number; bundle: string }): Promise<GenerationResult>;
	enable(accountId: string): Promise<unknown>;
	disable(accountId: string): Promise<void>;
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> };

class Rpc {
	#next = 0;
	#pending = new Map<number, Pending>();
	#post: (message: unknown, transfer: Transferable[]) => void;

	constructor(post: (message: unknown, transfer: Transferable[]) => void) {
		this.#post = post;
	}

	call<T>(request: object, timeoutMs?: number, transfer: Transferable[] = []): Promise<T> {
		const id = this.#next++;
		return new Promise<T>((resolve, reject) => {
			const pending: Pending = { resolve: resolve as (value: unknown) => void, reject };
			if (timeoutMs !== undefined) {
				pending.timer = setTimeout(() => {
					this.#pending.delete(id);
					reject(new Error('timeout'));
				}, timeoutMs);
			}
			this.#pending.set(id, pending);
			this.#post({ ...request, id }, transfer);
		});
	}

	settle(reply: Reply): void {
		const pending = this.#pending.get(reply.id);
		if (!pending) return;
		this.#pending.delete(reply.id);
		if (pending.timer !== undefined) clearTimeout(pending.timer);
		if (reply.ok) pending.resolve(reply.value);
		else pending.reject(new Error(reply.error));
	}

	fail(reason: string): void {
		for (const pending of this.#pending.values()) {
			if (pending.timer !== undefined) clearTimeout(pending.timer);
			pending.reject(new Error(reason));
		}
		this.#pending.clear();
	}
}

class Link {
	#port: MessagePort;
	#rpc: Rpc;
	#token = 0;
	#progress = new Map<number, (progress: Provisional) => void>();

	constructor(port: MessagePort, onStatus: (status: SearchStatus) => void) {
		this.#port = port;
		this.#rpc = new Rpc((message, transfer) => port.postMessage(message, transfer));
		port.onmessage = (e: MessageEvent<ClientMessage>) => {
			const m = e.data;
			if (!('type' in m)) this.#rpc.settle(m);
			else if (m.type === 'status') onStatus(m.status);
			else this.#progress.get(m.token)?.(m.progress);
		};
	}

	call<T>(request: ClientRequest, timeoutMs?: number): Promise<T> {
		return this.#rpc.call<T>(request, timeoutMs);
	}

	async query(
		query: ParsedQuery,
		ctx: QueryContext,
		options: QueryRequestOptions,
		signal?: AbortSignal,
		onProgress?: (progress: Provisional) => void
	): Promise<QueryReply> {
		const token = this.#token++;
		const cancel = () => void this.call({ op: 'cancel', token }).catch(() => undefined);
		signal?.addEventListener('abort', cancel, { once: true });
		if (onProgress) this.#progress.set(token, onProgress);
		try {
			return await this.call<QueryReply>({ op: 'query', token, query, ctx, options });
		} finally {
			this.#progress.delete(token);
			signal?.removeEventListener('abort', cancel);
		}
	}

	async meaning(query: ParsedQuery, ctx: QueryContext, options: MeaningRequestOptions, signal?: AbortSignal): Promise<MeaningReply> {
		const token = this.#token++;
		const cancel = () => void this.call({ op: 'cancel', token }).catch(() => undefined);
		signal?.addEventListener('abort', cancel, { once: true });
		try {
			return await this.call<MeaningReply>({ op: 'meaning', token, query, ctx, options });
		} finally {
			signal?.removeEventListener('abort', cancel);
		}
	}

	close(bye: boolean): void {
		if (bye) this.#port.postMessage({ op: 'bye', id: -1 });
		this.#rpc.fail('disconnected');
		this.#progress.clear();
		this.#port.onmessage = null;
		this.#port.close();
	}
}

interface Ownership {
	tenure: Tenure;
	worker: Worker | null;
	control: Rpc | null;
	stopWatching: (() => void) | null;
	claim: ReturnType<typeof setInterval> | null;
	persistent: boolean;
	stopBridge: (() => void) | null;
	syncing: Promise<void> | null;
	again: boolean;
	retry: ReturnType<typeof setTimeout> | null;
	model: Worker | null;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SearchClient {
	readonly accountId: string;
	readonly mode: Mode;
	#deps: ClientDeps;
	#state: ClientState = { phase: 'starting', role: null, status: null };
	#listeners = new Set<(state: ClientState) => void>();
	#broker: MessagePort | null = null;
	#contest: Contest | null = null;
	#owned: Ownership | null = null;
	#link: Link | null = null;
	#closed = false;
	#suspended = false;
	#seeking = 0;
	#lastSign = 0;
	#heartbeat: ReturnType<typeof setInterval> | undefined;
	#wakeSeek: (() => void) | null = null;
	#alone = false;
	#crashes = 0;

	constructor(accountId: string, deps: ClientDeps, mode: Mode = 'saved') {
		this.accountId = accountId;
		this.mode = mode;
		this.#deps = deps;
	}

	get state(): ClientState {
		return this.#state;
	}

	subscribe(listener: (state: ClientState) => void): () => void {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => this.#listeners.delete(listener);
	}

	start(): void {
		if (this.#contest || this.#closed) return;
		this.#broker = this.#deps.locks ? this.#deps.broker() : null;
		this.#alone = !this.#broker;
		if (this.#broker) {
			this.#broker.onmessage = (e: MessageEvent<BrokerEvent>) => this.#onBroker(e.data);
			this.#broker.start();
		}
		this.#lastSign = Date.now();
		this.#listen(true);
		this.#contest = contend(this.#alone ? null : this.#deps.locks, lockName(this.accountId), (tenure) => void this.#lead(tenure));
		if (!this.#owned) void this.#seek();
	}

	retry(): void {
		if (this.#closed || (this.#state.phase !== 'locked' && this.#state.phase !== 'unconverted' && this.#state.phase !== 'failed')) return;
		this.#crashes = 0;
		this.#set({ phase: 'starting', role: null, status: null });
		this.#lastSign = Date.now();
		this.#contest?.rejoin();
		void this.#seek();
	}

	async query(
		query: ParsedQuery,
		ctx: QueryContext,
		options: QueryRequestOptions,
		signal?: AbortSignal,
		onProgress?: (progress: Provisional) => void
	): Promise<QueryReply> {
		return this.#ready().query(query, ctx, options, signal, onProgress);
	}

	meaning(query: ParsedQuery, ctx: QueryContext, options: MeaningRequestOptions, signal?: AbortSignal): Promise<MeaningReply> {
		return this.#ready().meaning(query, ctx, options, signal);
	}

	complete(prefix: string): Promise<Completions> {
		return this.#ready().call<Completions>({ op: 'complete', prefix });
	}

	history(): Promise<string[]> {
		return this.#ready().call<string[]>({ op: 'history' });
	}

	async remember(query: string): Promise<void> {
		await this.#ready().call({ op: 'remember', query });
	}

	async forget(): Promise<void> {
		await this.#ready().call({ op: 'forget' });
	}

	async pause(paused: boolean): Promise<void> {
		await this.#ready().call({ op: 'pause', paused });
	}

	async retryFailed(): Promise<void> {
		await this.#ready().call({ op: 'retryFailed' });
	}

	async setCloudSync(enabled: boolean): Promise<void> {
		const cloud = this.#deps.cloud;
		if (!cloud) throw new Error('unavailable');
		if (enabled) await cloud.enable(this.accountId);
		else await cloud.disable(this.accountId);
		const owned = this.#owned;
		if (owned) await this.#resync(owned);
		else await this.#ready().call({ op: 'resync' });
	}

	page(session: number, index: number): Promise<PageResult> {
		return this.#ready().call<PageResult>({ op: 'page', session, index });
	}

	async closeQuery(session: number): Promise<void> {
		await this.#link?.call({ op: 'closeQuery', session }).catch(() => undefined);
	}

	async tell(job: string, message: unknown): Promise<boolean> {
		const control = this.#owned?.control;
		if (!control || this.#state.phase !== 'ready') return false;
		return control.call<boolean>({ op: 'job', name: job, message } satisfies ControlRequest);
	}

	async shutdown(options: { wipe: boolean } = { wipe: false }): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#listen(false);
		this.#wakeSeek?.();
		await this.#retire(options.wipe);
		this.#dropLink(true);
		this.#contest?.stop();
		this.#broker?.postMessage({ op: 'bye' } satisfies BrokerRequest);
		this.#broker?.close();
		this.#broker = null;
		this.#set({ phase: 'closed', role: null, status: null });
		if (options.wipe) await this.#wipe();
	}

	#ready(): Link {
		if (!this.#link || this.#state.phase !== 'ready') throw new Error('unavailable');
		return this.#link;
	}

	#set(next: ClientState): void {
		this.#state = next;
		for (const listener of this.#listeners) listener(next);
	}

	#post(request: BrokerRequest, transfer: Transferable[] = []): void {
		this.#broker?.postMessage(request, transfer);
	}

	#onStatus = (status: SearchStatus): void => {
		if (this.#state.phase === 'ready') this.#set({ ...this.#state, status });
	};

	#onBroker(event: BrokerEvent): void {
		if (event.accountId !== this.accountId) return;
		if (event.op === 'connect') {
			const control = this.#owned?.control;
			if (control && this.#state.phase === 'ready') {
				void control.call({ op: 'connect', port: event.port } satisfies ControlRequest, undefined, [event.port]).catch(() => undefined);
			} else {
				event.port.close();
			}
			return;
		}
		if (event.op === 'owner') {
			this.#lastSign = Date.now();
			if (event.ready) this.#wakeSeek?.();
		}
	}

	#suspend = (): void => {
		if (this.#closed || this.#suspended) return;
		this.#suspended = true;
		const owned = this.#owned;
		if (!owned) return;
		void this.#retire(false).then(() => {
			if (!this.#closed) this.#set({ phase: 'starting', role: null, status: null });
		});
	};

	#resume = (): void => {
		if (this.#closed || !this.#suspended) return;
		this.#suspended = false;
		this.#lastSign = Date.now();
		if (this.#state.phase === 'locked' || this.#state.phase === 'unconverted' || this.#state.phase === 'failed') return;
		this.#contest?.rejoin();
		void this.#seek();
	};

	#onPageHide = (e: PageTransitionEvent): void => {
		if (e.persisted) this.#suspend();
	};

	#listen(on: boolean): void {
		if (typeof document === 'undefined') return;
		const method = on ? 'addEventListener' : 'removeEventListener';
		document[method]('freeze', this.#suspend);
		document[method]('resume', this.#resume);
		window[method]('pagehide', this.#onPageHide as EventListener);
		window[method]('pageshow', this.#resume);
	}

	async #lead(tenure: Tenure): Promise<void> {
		if (this.#closed || this.#suspended) {
			tenure.release();
			return;
		}
		const owned: Ownership = {
			tenure,
			worker: null,
			control: null,
			stopWatching: null,
			claim: null,
			persistent: false,
			stopBridge: null,
			syncing: null,
			again: false,
			retry: null,
			model: null
		};
		this.#owned = owned;
		this.#seeking++;
		this.#wakeSeek?.();
		this.#dropLink(true);
		this.#set({ phase: 'starting', role: 'owner', status: null });
		this.#post({ op: 'claim', accountId: this.accountId });
		owned.claim = setInterval(() => this.#post({ op: 'claim', accountId: this.accountId }), CLAIM_EVERY_MS);
		void tenure.lost.then(() => this.#deposed(owned));
		let outcome: Phase;
		try {
			outcome = await this.#open(owned);
		} catch {
			outcome = 'failed';
		}
		if (owned.claim !== null) clearInterval(owned.claim);
		owned.claim = null;
		if (this.#owned !== owned) return;
		if (outcome === 'ready') return;
		await this.#retire(false);
		if (!this.#closed) this.#set({ phase: outcome, role: null, status: null });
	}

	async #deposed(owned: Ownership): Promise<void> {
		if (this.#owned !== owned) return;
		await this.#retire(false);
		if (this.#closed || this.#suspended) return;
		if (this.#crashes >= MAX_CRASHES) {
			this.#set({ phase: 'failed', role: null, status: null });
			return;
		}
		this.#set({ phase: 'starting', role: null, status: null });
		this.#lastSign = Date.now();
		this.#contest?.rejoin();
		void this.#seek();
	}

	async #root(port: MessagePort): Promise<{ record: SearchRecord } | { code: 'locked' | 'unconverted' | 'failed' }> {
		const { accountId } = this;
		const stored = await this.#deps.records.get(accountId);
		const opened = await this.#deps.openRoot({ accountId, bundle: stored?.bundle }, port);
		if (opened.ok) {
			if (stored && stored.generationId === opened.generationId) return { record: stored };
			if (!opened.bundle) return { code: 'failed' };
			const record: SearchRecord = {
				accountId,
				bundle: opened.bundle,
				generationId: opened.generationId,
				installationSalt: crypto.getRandomValues(new Uint8Array(SALT_BYTES)),
				hasIndex: false
			};
			await this.#deps.records.put(record);
			return { record };
		}
		if (opened.code === 'locked') return { code: 'locked' };
		if (opened.code === 'unavailable') return { code: 'unconverted' };
		if (!stored) return { code: 'failed' };
		await this.#deps.records.delete(accountId);
		return { code: 'failed' };
	}

	async #open(owned: Ownership): Promise<Phase> {
		const live = () => this.#owned === owned && !this.#closed;
		let record: SearchRecord | null = null;
		let keystore: MessagePort | null = null;
		const prefs = await this.#deps.prefs.get(this.accountId);
		if (!live()) return 'starting';
		if (!this.#alone && this.mode === 'saved') {
			for (let attempt = 0; attempt < 2 && !record; attempt++) {
				const channel = new MessageChannel();
				const root = await this.#root(channel.port2);
				if (!live()) {
					channel.port1.close();
					return 'starting';
				}
				if ('record' in root) {
					record = root.record;
					keystore = channel.port1;
				} else {
					channel.port1.close();
					if (root.code === 'locked' || root.code === 'unconverted') return root.code;
				}
			}
			if (!record || !keystore) return 'failed';
		}

		const worker = this.#deps.spawn();
		const control = new Rpc((message, transfer) => worker.postMessage(message, transfer));
		owned.worker = worker;
		owned.control = control;
		worker.onmessage = (e: MessageEvent<Reply | WorkerEvent>) => {
			const m = e.data;
			if (!('type' in m)) control.settle(m);
			else if (m.type === 'resync') void this.#resync(owned);
			else if (m.op === 'spawn') this.#spawnModel(owned);
			else this.#stopModel(owned);
		};
		worker.onerror = () => {
			control.fail('crashed');
			this.#crashes++;
			if (this.#owned === owned && this.#state.phase === 'ready') owned.tenure.release();
		};

		let bridge: MessagePort | undefined;
		if (this.#deps.serveBridge) {
			const channel = new MessageChannel();
			owned.stopBridge = this.#deps.serveBridge(this.accountId, channel.port1, { onSyncChanged: () => void this.#resync(owned) });
			bridge = channel.port2;
		}
		const parser = this.#deps.parser?.() ?? undefined;
		const request: ControlRequest =
			record && keystore
				? {
						op: 'init',
						accountId: this.accountId,
						generationId: record.generationId,
						installationSalt: record.installationSalt,
						keystore,
						bridge,
						parser,
						paused: prefs.paused,
						semantic: prefs.semantic,
						syncPending: true
					}
				: { op: 'memory', bridge, parser, mode: this.mode, paused: prefs.paused, semantic: prefs.semantic };
		const transfer: Transferable[] = [];
		if (keystore) transfer.push(keystore);
		if (bridge) transfer.push(bridge);
		if (parser) transfer.push(parser);
		const result = await control.call<InitResult>(request, undefined, transfer);
		if (!live()) return 'starting';
		if (!result.ok) return result.code;
		owned.persistent = result.status.persistence === 'persistent';
		if (record && owned.persistent && !record.hasIndex) {
			await this.#deps.records.put({ ...record, hasIndex: true });
			if (!live()) return 'starting';
		}

		const channel = new MessageChannel();
		const connected = await control.call<boolean>({ op: 'connect', port: channel.port2 } satisfies ControlRequest, undefined, [channel.port2]);
		if (!live() || !connected) {
			channel.port1.close();
			return live() ? 'failed' : 'starting';
		}
		this.#link = new Link(channel.port1, this.#onStatus);
		owned.stopWatching = this.#deps.watch((conditions) => {
			void control.call({ op: 'activity', conditions } satisfies ControlRequest).catch(() => undefined);
		});
		this.#set({ phase: 'ready', role: 'owner', status: result.status });
		this.#post({ op: 'own', accountId: this.accountId });
		if (record) void this.#resync(owned);
		return 'ready';
	}

	#spawnModel(owned: Ownership): void {
		const control = owned.control;
		if (!control) return;
		this.#stopModel(owned);
		const send = (port: MessagePort | null) => {
			void control.call({ op: 'model', port } satisfies ControlRequest, undefined, port ? [port] : []).catch(() => port?.close());
		};
		if (this.#owned !== owned || !this.#deps.spawnModel) {
			send(null);
			return;
		}
		let model: Worker;
		try {
			model = this.#deps.spawnModel();
		} catch {
			send(null);
			return;
		}
		owned.model = model;
		const channel = new MessageChannel();
		model.onerror = () => {
			if (owned.model !== model) return;
			this.#stopModel(owned);
			send(null);
		};
		model.postMessage({ op: 'init', port: channel.port1 }, [channel.port1]);
		send(channel.port2);
	}

	#stopModel(owned: Ownership): void {
		owned.model?.terminate();
		owned.model = null;
	}

	#resync(owned: Ownership): Promise<void> {
		if (owned.syncing) {
			owned.again = true;
			return owned.syncing;
		}
		owned.syncing = (async () => {
			try {
				do {
					owned.again = false;
					await this.#attachSync(owned);
				} while (owned.again && this.#owned === owned);
			} finally {
				owned.syncing = null;
			}
		})();
		return owned.syncing;
	}

	async #attachSync(owned: Ownership): Promise<void> {
		const control = owned.control;
		if (!control) return;
		if (owned.retry !== null) clearTimeout(owned.retry);
		owned.retry = null;
		const cloud = this.#deps.cloud;
		const send = async (request: Extract<ControlRequest, { op: 'sync' }>, transfer: Transferable[] = []) => {
			await control.call(request, undefined, transfer).catch(() => request.sync?.keystore.close());
		};
		if (!cloud || !owned.persistent) {
			await send({ op: 'sync', sync: null, cloud: cloud ? 'unavailable' : null });
			return;
		}
		const resolved = await resolveSync(this.accountId, { ...cloud, openRoot: this.#deps.openRoot, records: this.#deps.records });
		if (this.#owned !== owned) {
			if (resolved.ok) resolved.attach.keystore.close();
			return;
		}
		const state: CloudState = resolved.ok ? 'on' : resolved.reason;
		if (state === 'error') owned.retry = setTimeout(() => void this.#resync(owned), RESYNC_RETRY_MS);
		if (resolved.ok) await send({ op: 'sync', sync: resolved.attach, cloud: state }, [resolved.attach.keystore]);
		else await send({ op: 'sync', sync: null, cloud: state });
	}

	async #retire(wipe: boolean): Promise<void> {
		const owned = this.#owned;
		if (!owned) return;
		this.#owned = null;
		if (owned.claim !== null) clearInterval(owned.claim);
		if (owned.retry !== null) clearTimeout(owned.retry);
		owned.retry = null;
		owned.stopWatching?.();
		owned.stopBridge?.();
		owned.stopBridge = null;
		this.#post({ op: 'release', accountId: this.accountId });
		this.#stopModel(owned);
		this.#dropLink(false);
		if (owned.worker && owned.control) {
			await owned.control.call({ op: 'close', wipe } satisfies ControlRequest, CLOSE_TIMEOUT_MS).catch(() => undefined);
			owned.control.fail('closed');
			owned.worker.terminate();
		}
		owned.tenure.release();
	}

	#dropLink(bye: boolean): void {
		if (this.#heartbeat !== undefined) clearInterval(this.#heartbeat);
		this.#heartbeat = undefined;
		this.#link?.close(bye);
		this.#link = null;
	}

	#pause(ms: number): Promise<void> {
		return new Promise((resolve) => {
			const timer = setTimeout(done, ms);
			const self = this;
			function done() {
				clearTimeout(timer);
				if (self.#wakeSeek === done) self.#wakeSeek = null;
				resolve();
			}
			this.#wakeSeek = done;
		});
	}

	async #seek(): Promise<void> {
		const run = ++this.#seeking;
		const current = () => run === this.#seeking && !this.#closed && !this.#suspended && !this.#owned;
		while (current()) {
			if (!this.#broker) return;
			const channel = new MessageChannel();
			this.#post({ op: 'connect', accountId: this.accountId, port: channel.port2 }, [channel.port2]);
			const link = new Link(channel.port1, this.#onStatus);
			let status: SearchStatus | null = null;
			try {
				status = await link.call<SearchStatus>({ op: 'status' }, CONNECT_TIMEOUT_MS);
			} catch {
				status = null;
			}
			if (!current()) {
				link.close(status !== null);
				return;
			}
			if (status) {
				this.#follow(link, status);
				return;
			}
			link.close(false);
			if (Date.now() - this.#lastSign > STEAL_AFTER_MS) {
				this.#lastSign = Date.now();
				this.#contest?.steal();
			}
			await this.#pause(RETRY_MS);
		}
	}

	#follow(link: Link, status: SearchStatus): void {
		this.#link = link;
		this.#lastSign = Date.now();
		this.#set({ phase: 'ready', role: 'follower', status });
		this.#heartbeat = setInterval(() => {
			link.call({ op: 'ping' }, PING_TIMEOUT_MS).then(
				() => {
					this.#lastSign = Date.now();
				},
				() => {
					if (this.#link !== link) return;
					this.#dropLink(false);
					this.#set({ phase: 'starting', role: null, status: null });
					void this.#seek();
				}
			);
		}, PING_EVERY_MS);
	}

	async #wipe(): Promise<void> {
		await this.#deps.records.delete(this.accountId).catch(() => undefined);
		if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return;
		for (let attempt = 0; attempt < 3; attempt++) {
			try {
				const root = await navigator.storage.getDirectory();
				await root.removeEntry(directoryFor(this.accountId), { recursive: true });
				return;
			} catch (error) {
				if ((error as DOMException)?.name === 'NotFoundError') return;
				await delay(RETRY_MS);
			}
		}
	}
}
