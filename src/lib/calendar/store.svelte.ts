import { browser } from '$app/environment';
import { SvelteMap } from 'svelte/reactivity';
import {
	createCalendar,
	deleteCalendar as apiDeleteCalendar,
	deleteCalendarItem as apiDeleteItem,
	getCalendarItem,
	listCalendarItemRevisions,
	putCalendarItem,
	restoreCalendarItemRevision,
	putCalendarItemState,
	updateCalendar,
	type CalendarItemRow,
	type CalendarItemStateRow,
	type CalendarRow
} from '$lib/api/calendars';
import { coalesce } from '$lib/realtime/coalesce';
import { electLeader, type LeaderHandle } from '$lib/realtime/leader';
import { registerCalendarRealtime } from '$lib/realtime/calendarHook';
import type { RealtimeHint } from '$lib/realtime/types';
import { auth } from '$lib/stores/auth.svelte';
import { accountSettings } from '$lib/stores/accountSettings.svelte';
import { calendarKeys } from '$lib/stores/calendarKeys.svelte';
import { dispatchSend } from '$lib/mail/sendDispatch';
import { onCalendarMessage, postCalendarMessage } from './channel';
import {
	idbCalendarDb,
	memoryCalendarDb,
	type CachedItem,
	type CalendarDb,
	type OutboxRecord
} from './db';
import {
	ITEM_SCHEMA_VERSION,
	META_SCHEMA_VERSION,
	STATE_SCHEMA_VERSION,
	parseItem,
	parseMeta,
	parseState,
	serializeItem,
	serializeMeta,
	serializeState,
	type CalendarItem,
	type CalendarMeta,
	type MemberState,
	type Privacy
} from './model';
import { replayOne, type OutboxMail, type OutboxOp, type ReplayApi } from './outbox';
import { busyWindows, expandItems, itemSpan, type Occurrence } from './recur';
import { keyForCalendar, openText, ownKey, sealText, SealError, type SealKey } from './seal';
import { fullLoad, liveSyncApi, pullChanges, type SyncApi } from './sync';

export interface CalendarView {
	id: string;
	row: CalendarRow;
	meta: CalendarMeta | null;
	name: string;
	color: string;
	kind: CalendarRow['kind'];
	role: CalendarRow['callerRole'];
	canWrite: boolean;
	canManage: boolean;
	rotationRequired: boolean;
	unreadable: boolean;
}

export interface RevisionView {
	rev: number;
	createdAt: string;
	deleted: boolean;
	mine: boolean;
	item: CalendarItem | null;
}

export interface LoadedItem {
	item: CalendarItem;
	rev: number;
	updatedAt: string;
	pending: boolean;
	unreadable: boolean;
	keyFingerprint: string;
}

export interface SaveOptions {
	fields?: string[];
	label?: string;
}

type MessageListener = (hint: RealtimeHint) => void;

const REALTIME_COALESCE_MS = 750;

function labelFor(item: CalendarItem, verb: string): string {
	const title = item.kind === 'hold' ? 'a private hold' : item.title || 'untitled';
	return `${verb} ${item.kind === 'hold' ? title : `“${title}”`}`;
}

export class CalendarStore {
	calendars = $state<CalendarView[]>([]);
	loaded = $state(false);
	loading = $state(false);
	loadError = $state<string | null>(null);
	online = $state(true);
	offlineSince = $state<number | null>(null);
	lastSyncAt = $state<number | null>(null);
	queue = $state<OutboxRecord[]>([]);
	halted = $state<string | null>(null);
	syncing = $state(false);
	items = new SvelteMap<string, LoadedItem>();
	states = new SvelteMap<string, MemberState>();
	revision = $state(0);

	#db: CalendarDb;
	#api: SyncApi;
	#accountId: string | null = null;
	#cursor: string | null = null;
	#leader: LeaderHandle | null = null;
	#leading = false;
	#replayTimer: ReturnType<typeof setTimeout> | null = null;
	#replaying = false;
	#stopChannel: (() => void) | null = null;
	#stopRealtime: (() => void) | null = null;
	#pendingSync: Promise<void> | null = null;
	#loadPromise: Promise<void> | null = null;
	#messageListeners = new Set<MessageListener>();
	#syncCoalesced = coalesce(() => void this.syncDelta(), REALTIME_COALESCE_MS);

	constructor(db?: CalendarDb, api?: SyncApi) {
		this.#db = db ?? (browser ? idbCalendarDb : memoryCalendarDb());
		this.#api = api ?? liveSyncApi;
	}

	get accountId(): string | null {
		return this.#accountId;
	}

	get pendingCount(): number {
		return this.queue.filter((q) => q.status !== 'blocked').length;
	}

	get blockedCount(): number {
		return this.queue.filter((q) => q.status === 'blocked').length;
	}

	get showSystemBar(): boolean {
		return !this.online || this.pendingCount > 0 || this.blockedCount > 0 || this.halted !== null;
	}

	get writableCalendars(): CalendarView[] {
		return this.calendars.filter((c) => c.canWrite && !c.unreadable);
	}

	get visibleCalendarIds(): Set<string> {
		const hidden = new Set(accountSettings.calendar.hidden);
		return new Set(this.calendars.filter((c) => !hidden.has(c.id)).map((c) => c.id));
	}

	get defaultCalendar(): CalendarView | null {
		const preferred = accountSettings.calendar.defaultCalendarId;
		const writable = this.writableCalendars;
		return (
			writable.find((c) => c.id === preferred) ??
			writable.find((c) => c.kind === 'personal') ??
			writable[0] ??
			null
		);
	}

	setAccount(accountId: string | null): void {
		if (this.#accountId === accountId) return;
		this.stop();
		this.#accountId = accountId;
		this.calendars = [];
		this.items.clear();
		this.states.clear();
		this.queue = [];
		this.loaded = false;
		this.loading = false;
		this.loadError = null;
		this.halted = null;
		this.#cursor = null;
		this.revision += 1;
	}

	start(): void {
		if (!browser || !this.#accountId) return;
		if (!this.#stopChannel) {
			this.#stopChannel = onCalendarMessage((msg) => {
				if (msg.accountId !== this.#accountId) return;
				if (msg.type === 'changed') void this.#hydrate();
				if (msg.type === 'queue') void this.#loadQueue();
			});
		}
		if (!this.#stopRealtime) {
			this.#stopRealtime = registerCalendarRealtime({
				onHint: () => this.#syncCoalesced(),
				onMessage: (hint) => {
					for (const listener of this.#messageListeners) listener(hint);
				},
				onResync: () => this.#syncCoalesced()
			});
		}
		if (!this.#leader) {
			this.#leader = electLeader('thelemail:calendar-outbox', () => {
				this.#leading = true;
				this.#kick();
				const onlineHandler = () => this.#kick();
				window.addEventListener('online', onlineHandler);
				return () => {
					window.removeEventListener('online', onlineHandler);
					this.#leading = false;
				};
			});
		}
	}

	stop(): void {
		this.#leader?.stop();
		this.#leader = null;
		this.#leading = false;
		this.#stopChannel?.();
		this.#stopChannel = null;
		this.#stopRealtime?.();
		this.#stopRealtime = null;
		if (this.#replayTimer) clearTimeout(this.#replayTimer);
		this.#replayTimer = null;
	}

	onMessage(listener: MessageListener): () => void {
		this.#messageListeners.add(listener);
		return () => this.#messageListeners.delete(listener);
	}

	ensureLoaded(): Promise<void> {
		if (this.loaded) return Promise.resolve();
		if (this.#loadPromise) return this.#loadPromise;
		if (auth.canEnterApp && auth.accountId && auth.accountId !== this.#accountId) {
			this.setAccount(auth.accountId);
		}
		const accountId = this.#accountId;
		if (!accountId) return Promise.resolve();
		this.#loadPromise = this.#load(accountId).finally(() => {
			this.#loadPromise = null;
		});
		return this.#loadPromise;
	}

	async #load(accountId: string): Promise<void> {
		this.loading = true;
		this.loadError = null;
		try {
			await calendarKeys.ready(accountId);
			const sync = await this.#db.sync(accountId);
			this.#cursor = sync?.cursor ?? null;
			this.lastSyncAt = sync?.lastSyncAt ?? null;
			if (sync?.loaded) {
				await this.#hydrate();
				this.loaded = true;
				this.start();
				await this.syncDelta();
				await this.#ensurePersonal(accountId);
				return;
			}
			await this.#fullLoad();
			this.loaded = true;
			this.start();
			await this.#ensurePersonal(accountId);
		} catch (err) {
			this.loadError = err instanceof Error ? err.message : 'Could not load the calendar';
			this.#noteFailure(err);
		} finally {
			if (this.#accountId === accountId) this.loading = false;
		}
	}

	async refresh(): Promise<void> {
		if (!this.loaded) return this.ensureLoaded();
		await this.syncDelta();
	}

	async syncDelta(): Promise<void> {
		if (this.#pendingSync) return this.#pendingSync;
		this.#pendingSync = this.#syncDelta().finally(() => {
			this.#pendingSync = null;
		});
		return this.#pendingSync;
	}

	async #syncDelta(): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId || !this.loaded) return;
		this.syncing = true;
		try {
			if (!this.#cursor) {
				await this.#fullLoad();
				return;
			}
			const delta = await pullChanges(accountId, this.#api, this.#db, this.#cursor);
			if (this.#accountId !== accountId) return;
			if (delta.resync) {
				await this.#fullLoad();
				return;
			}
			this.#cursor = delta.cursor;
			this.lastSyncAt = Date.now();
			this.#noteOnline();
			if (delta.changed) {
				await this.#hydrate();
				postCalendarMessage({ type: 'changed', accountId });
			}
			this.#kick();
		} catch (err) {
			this.#noteFailure(err);
		} finally {
			if (this.#accountId === accountId) this.syncing = false;
		}
	}

	async #fullLoad(): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId) return;
		const result = await fullLoad(accountId, this.#api, this.#db);
		if (this.#accountId !== accountId) return;
		this.#cursor = result.cursor;
		this.lastSyncAt = Date.now();
		this.#noteOnline();
		await this.#hydrate();
		postCalendarMessage({ type: 'changed', accountId });
	}

	#creatingPersonal = false;

	async #ensurePersonal(accountId: string): Promise<void> {
		if (this.#creatingPersonal || !this.online) return;
		if (this.calendars.some((c) => c.kind === 'personal' && c.row.ownerAccountId === accountId))
			return;
		this.#creatingPersonal = true;
		try {
			await this.#createPersonalCalendar(accountId);
		} catch (err) {
			this.#noteFailure(err);
		} finally {
			this.#creatingPersonal = false;
		}
	}

	async #createPersonalCalendar(accountId: string): Promise<void> {
		const key = await ownKey(accountId);
		const meta: CalendarMeta = {
			schemaVersion: META_SCHEMA_VERSION,
			name: 'My calendar',
			color: '#2E5440',
			defaultPrivacy: accountSettings.calendar.defaultPrivacy
		};
		const sealedMeta = await sealText(accountId, key, serializeMeta(meta));
		const row = await createCalendar({
			kind: 'personal',
			sealedMeta,
			metaKeyFingerprint: key.fingerprintB64,
			metaSchemaVersion: META_SCHEMA_VERSION
		});
		if (this.#accountId !== accountId) return;
		await this.adoptCalendar(row);
	}

	async #hydrate(): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId) return;
		const [cals, cached, states] = await Promise.all([
			this.#db.calendars(accountId),
			this.#db.items(accountId),
			this.#db.states(accountId)
		]);
		if (this.#accountId !== accountId) return;
		const views: CalendarView[] = [];
		for (const c of cals) views.push(await this.#viewFor(accountId, c.row));
		views.sort((a, b) => a.row.createdAt.localeCompare(b.row.createdAt));
		const nextItems = new Map<string, LoadedItem>();
		const reindex: CachedItem[] = [];
		for (const entry of cached) {
			const previous = this.items.get(entry.id);
			if (
				previous &&
				previous.rev === entry.row.rev &&
				previous.updatedAt === entry.row.updatedAt &&
				!previous.unreadable
			) {
				nextItems.set(entry.id, { ...previous, pending: !!entry.pending });
				continue;
			}
			const loaded = await this.#openItem(accountId, entry.row, !!entry.pending);
			nextItems.set(entry.id, loaded);
			if (!loaded.unreadable) {
				const span = itemSpan(loaded.item);
				reindex.push({
					...entry,
					uid: loaded.item.uid,
					kind: loaded.item.kind,
					spanStart: span.start,
					spanEnd: span.end
				});
			}
		}
		if (this.#accountId !== accountId) return;
		if (reindex.length) void this.#db.putItems(reindex);
		this.calendars = views;
		this.items.clear();
		for (const [id, loaded] of nextItems) this.items.set(id, loaded);
		this.states.clear();
		for (const st of states) {
			const opened = await this.#openState(accountId, st.row);
			if (opened) this.states.set(st.itemId, opened);
		}
		await this.#loadQueue();
		this.revision += 1;
	}

	async #viewFor(accountId: string, row: CalendarRow): Promise<CalendarView> {
		let meta: CalendarMeta | null = null;
		let unreadable = false;
		try {
			meta = parseMeta(await openText(accountId, row.sealedMeta, row.metaKeyFingerprint));
		} catch {
			unreadable = true;
		}
		const role = row.callerRole ?? null;
		const canWrite = role === 'owner' || role === 'editor';
		const canManage =
			role === 'owner' ||
			(row.kind !== 'personal' && (auth.accountId === row.ownerAccountId || canWrite));
		return {
			id: row.id,
			row,
			meta,
			name: meta?.name ?? (row.kind === 'role' ? 'Role calendar' : 'Calendar'),
			color: meta?.color ?? '#2E5440',
			kind: row.kind,
			role,
			canWrite,
			canManage,
			rotationRequired: row.rotationRequired,
			unreadable
		};
	}

	async #openItem(accountId: string, row: CalendarItemRow, pending: boolean): Promise<LoadedItem> {
		try {
			const item = parseItem(await openText(accountId, row.sealed, row.keyFingerprint));
			return {
				item,
				rev: row.rev,
				updatedAt: row.updatedAt,
				pending,
				unreadable: false,
				keyFingerprint: row.keyFingerprint
			};
		} catch {
			const placeholder: CalendarItem = {
				schemaVersion: ITEM_SCHEMA_VERSION,
				id: row.id,
				kind: 'event',
				calendarId: row.calendarId,
				title: 'Cannot open this item on this device',
				privacy: row.privacy,
				uid: row.id,
				sequence: 0,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt
			};
			return {
				item: placeholder,
				rev: row.rev,
				updatedAt: row.updatedAt,
				pending,
				unreadable: true,
				keyFingerprint: row.keyFingerprint
			};
		}
	}

	async #openState(accountId: string, row: CalendarItemStateRow): Promise<MemberState | null> {
		try {
			return parseState(await openText(accountId, row.sealed, row.keyFingerprint));
		} catch {
			return null;
		}
	}

	async #loadQueue(): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId) return;
		const rows = await this.#db.outbox(accountId);
		if (this.#accountId !== accountId) return;
		this.queue = rows;
	}

	calendar(id: string): CalendarView | undefined {
		return this.calendars.find((c) => c.id === id);
	}

	item(id: string): LoadedItem | undefined {
		return this.items.get(id);
	}

	itemByUid(uid: string): LoadedItem | undefined {
		for (const entry of this.items.values()) {
			if (entry.item.uid === uid && !entry.unreadable) return entry;
		}
		return undefined;
	}

	stateFor(itemId: string, accountId: string): MemberState | undefined {
		return this.states.get(`${itemId}:${accountId}`);
	}

	myState(itemId: string): MemberState | undefined {
		return this.#accountId ? this.stateFor(itemId, this.#accountId) : undefined;
	}

	statesFor(itemId: string): { accountId: string; state: MemberState }[] {
		const out: { accountId: string; state: MemberState }[] = [];
		const prefix = `${itemId}:`;
		for (const [key, state] of this.states) {
			if (key.startsWith(prefix)) out.push({ accountId: key.slice(prefix.length), state });
		}
		return out;
	}

	occurrencesIn(
		from: Date,
		to: Date,
		opts: { calendars?: Set<string>; includeHidden?: boolean } = {}
	): Occurrence[] {
		void this.revision;
		const allowed = opts.calendars ?? (opts.includeHidden ? null : this.visibleCalendarIds);
		const source: CalendarItem[] = [];
		for (const entry of this.items.values()) {
			if (entry.unreadable) continue;
			if (allowed && !allowed.has(entry.item.calendarId)) continue;
			source.push(entry.item);
		}
		return expandItems(source, from, to);
	}

	tasks(opts: { includeHidden?: boolean } = {}): LoadedItem[] {
		void this.revision;
		const allowed = opts.includeHidden ? null : this.visibleCalendarIds;
		const out: LoadedItem[] = [];
		for (const entry of this.items.values()) {
			if (entry.unreadable || entry.item.kind !== 'task') continue;
			if (allowed && !allowed.has(entry.item.calendarId)) continue;
			out.push(entry);
		}
		return out;
	}

	async #sealItem(
		accountId: string,
		item: CalendarItem
	): Promise<{ sealed: string; key: SealKey }> {
		const cal = this.calendar(item.calendarId);
		if (!cal) throw new SealError('no_key', 'Unknown calendar');
		const key = await keyForCalendar(accountId, cal.row);
		const sealed = await sealText(accountId, key, serializeItem(item));
		return { sealed, key };
	}

	async saveItem(draft: CalendarItem, opts: SaveOptions = {}): Promise<LoadedItem> {
		const accountId = this.#accountId;
		if (!accountId) throw new Error('No account');
		const existing = this.items.get(draft.id);
		const now = new Date().toISOString();
		const item: CalendarItem = {
			...draft,
			schemaVersion: ITEM_SCHEMA_VERSION,
			createdAt: existing?.item.createdAt ?? draft.createdAt ?? now,
			updatedAt: now
		};
		const { sealed, key } = await this.#sealItem(accountId, item);
		const baseRev = existing?.rev ?? 0;
		const op: OutboxOp = {
			kind: 'item.put',
			calendarId: item.calendarId,
			itemId: item.id,
			label: opts.label ?? labelFor(item, existing ? 'Edited' : 'Created'),
			fields: opts.fields,
			body: {
				baseRev,
				privacy: item.privacy,
				sealed,
				keyFingerprint: key.fingerprintB64,
				schemaVersion: ITEM_SCHEMA_VERSION,
				busyWindows: busyWindows(item)
			}
		};
		const row: CalendarItemRow = {
			id: item.id,
			calendarId: item.calendarId,
			rev: baseRev,
			privacy: item.privacy,
			sealed,
			keyFingerprint: key.fingerprintB64,
			schemaVersion: ITEM_SCHEMA_VERSION,
			busyWindows: op.body.busyWindows,
			createdAt: item.createdAt,
			updatedAt: now
		};
		const span = itemSpan(item);
		await this.#db.putItem({
			accountId,
			id: item.id,
			calendarId: item.calendarId,
			row,
			uid: item.uid,
			kind: item.kind,
			spanStart: span.start,
			spanEnd: span.end,
			pending: true
		});
		const loaded: LoadedItem = {
			item,
			rev: baseRev,
			updatedAt: now,
			pending: true,
			unreadable: false,
			keyFingerprint: key.fingerprintB64
		};
		this.items.set(item.id, loaded);
		this.revision += 1;
		await this.#enqueue(op);
		return loaded;
	}

	async deleteItem(id: string): Promise<void> {
		const accountId = this.#accountId;
		const existing = this.items.get(id);
		if (!accountId || !existing) return;
		this.items.delete(id);
		this.revision += 1;
		await this.#db.deleteItem(accountId, id);
		if (existing.rev === 0) {
			const pendingCreate = this.queue.find(
				(q) => q.op.kind === 'item.put' && q.op.itemId === id && q.status !== 'sending'
			);
			if (pendingCreate) {
				await this.#db.removeOutbox(pendingCreate.seq);
				await this.#loadQueue();
				return;
			}
		}
		await this.#enqueue({
			kind: 'item.delete',
			calendarId: existing.item.calendarId,
			itemId: id,
			baseRev: existing.rev,
			label: labelFor(existing.item, 'Deleted')
		});
	}

	async setMyState(itemId: string, patch: Partial<MemberState>, label: string): Promise<void> {
		const accountId = this.#accountId;
		const entry = this.items.get(itemId);
		if (!accountId || !entry) return;
		const cal = this.calendar(entry.item.calendarId);
		if (!cal) return;
		const current = this.myState(itemId) ?? { schemaVersion: STATE_SCHEMA_VERSION };
		const next: MemberState = { ...current, ...patch, schemaVersion: STATE_SCHEMA_VERSION };
		const key = await keyForCalendar(accountId, cal.row);
		const sealed = await sealText(accountId, key, serializeState(next));
		this.states.set(`${itemId}:${accountId}`, next);
		this.revision += 1;
		await this.#db.putState({
			accountId,
			itemId: `${itemId}:${accountId}`,
			row: {
				itemId,
				calendarId: entry.item.calendarId,
				accountId,
				sealed,
				keyFingerprint: key.fingerprintB64,
				schemaVersion: STATE_SCHEMA_VERSION,
				rev: 0,
				updatedAt: new Date().toISOString()
			}
		});
		await this.#enqueue({
			kind: 'state.put',
			calendarId: entry.item.calendarId,
			itemId,
			label,
			body: { sealed, keyFingerprint: key.fingerprintB64, schemaVersion: STATE_SCHEMA_VERSION }
		});
	}

	async updateCalendarMeta(calendarId: string, meta: CalendarMeta): Promise<void> {
		const accountId = this.#accountId;
		const cal = this.calendar(calendarId);
		if (!accountId || !cal) return;
		const key = await keyForCalendar(accountId, cal.row);
		const sealed = await sealText(accountId, key, serializeMeta(meta));
		const row: CalendarRow = {
			...cal.row,
			sealedMeta: sealed,
			metaKeyFingerprint: key.fingerprintB64
		};
		await this.#db.putCalendar({ accountId, id: calendarId, row });
		this.calendars = this.calendars.map((c) =>
			c.id === calendarId ? { ...c, row, meta, name: meta.name, color: meta.color } : c
		);
		await this.#enqueue({
			kind: 'calendar.patch',
			calendarId,
			label: `Renamed “${meta.name}”`,
			body: {
				sealedMeta: sealed,
				metaKeyFingerprint: key.fingerprintB64,
				metaSchemaVersion: meta.schemaVersion,
				baseRev: cal.row.rev
			}
		});
	}

	async adoptCalendar(row: CalendarRow): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId) return;
		await this.#db.putCalendar({ accountId, id: row.id, row });
		const view = await this.#viewFor(accountId, row);
		this.calendars = [...this.calendars.filter((c) => c.id !== row.id), view].sort((a, b) =>
			a.row.createdAt.localeCompare(b.row.createdAt)
		);
		this.revision += 1;
	}

	async removeCalendar(calendarId: string): Promise<void> {
		const accountId = this.#accountId;
		const cal = this.calendar(calendarId);
		if (!accountId || !cal) return;
		this.calendars = this.calendars.filter((c) => c.id !== calendarId);
		for (const [id, entry] of [...this.items]) {
			if (entry.item.calendarId === calendarId) {
				this.items.delete(id);
				await this.#db.deleteItem(accountId, id);
			}
		}
		await this.#db.deleteCalendar(accountId, calendarId);
		this.revision += 1;
		await this.#enqueue({ kind: 'calendar.delete', calendarId, label: `Deleted “${cal.name}”` });
	}

	async resealCalendar(calendarId: string): Promise<void> {
		for (const entry of [...this.items.values()]) {
			if (entry.item.calendarId !== calendarId || entry.unreadable) continue;
			await this.saveItem(entry.item, { label: `Re-sealed “${entry.item.title || 'untitled'}”` });
		}
	}

	async queueMail(itemId: string, mail: OutboxMail, label: string): Promise<void> {
		await this.#enqueue({ kind: 'invite.send', itemId, mail, label });
	}

	async #enqueue(op: OutboxOp): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId) return;
		await this.#db.enqueue({ accountId, op, status: 'queued', attempts: 0, createdAt: Date.now() });
		await this.#loadQueue();
		postCalendarMessage({ type: 'queue', accountId });
		this.#kick();
	}

	flush(): void {
		this.halted = null;
		this.#kick();
	}

	async retryOp(seq: number): Promise<void> {
		const rec = this.queue.find((q) => q.seq === seq);
		if (!rec) return;
		await this.#db.updateOutbox({
			...rec,
			status: 'queued',
			attempts: 0,
			lastError: undefined,
			conflict: undefined
		});
		await this.#loadQueue();
		this.#kick();
	}

	async discardOp(seq: number): Promise<void> {
		const rec = this.queue.find((q) => q.seq === seq);
		if (!rec) return;
		await this.#db.removeOutbox(seq);
		await this.#loadQueue();
		if (rec.op.kind === 'item.put' || rec.op.kind === 'item.delete') {
			await this.#reloadItem(rec.op.calendarId, rec.op.itemId);
		}
	}

	async keepMine(seq: number): Promise<void> {
		const rec = this.queue.find((q) => q.seq === seq);
		const accountId = this.#accountId;
		if (!rec || !accountId) return;
		if (rec.op.kind === 'item.put') {
			const server = await getCalendarItem(rec.op.calendarId, rec.op.itemId).catch(() => null);
			const baseRev = server?.item.rev ?? rec.op.body.baseRev;
			const local = this.items.get(rec.op.itemId);
			let body = { ...rec.op.body, baseRev };
			if (local && !local.unreadable) {
				const { sealed, key } = await this.#sealItem(accountId, local.item);
				body = { ...body, sealed, keyFingerprint: key.fingerprintB64 };
			}
			await this.#db.updateOutbox({
				...rec,
				op: { ...rec.op, body },
				status: 'queued',
				attempts: 0,
				lastError: undefined,
				conflict: undefined
			});
		} else if (rec.op.kind === 'item.delete') {
			const server = await getCalendarItem(rec.op.calendarId, rec.op.itemId).catch(() => null);
			await this.#db.updateOutbox({
				...rec,
				op: { ...rec.op, baseRev: server?.item.rev ?? rec.op.baseRev },
				status: 'queued',
				attempts: 0,
				lastError: undefined,
				conflict: undefined
			});
		} else {
			await this.#db.updateOutbox({
				...rec,
				status: 'queued',
				attempts: 0,
				lastError: undefined,
				conflict: undefined
			});
		}
		await this.#loadQueue();
		this.#kick();
	}

	async takeTheirs(seq: number): Promise<void> {
		await this.discardOp(seq);
	}

	async listRevisions(itemId: string): Promise<RevisionView[]> {
		const accountId = this.#accountId;
		const entry = this.items.get(itemId);
		if (!accountId || !entry) return [];
		const { revisions } = await listCalendarItemRevisions(entry.item.calendarId, itemId);
		const out: RevisionView[] = [];
		for (const r of revisions) {
			let item: CalendarItem | null = null;
			try {
				item = parseItem(await openText(accountId, r.sealed, r.keyFingerprint));
			} catch {
				item = null;
			}
			out.push({
				rev: r.rev,
				createdAt: r.createdAt,
				deleted: r.deleted,
				mine: r.updatedById === accountId,
				item
			});
		}
		return out;
	}

	async restoreRevision(itemId: string, rev: number): Promise<void> {
		const entry = this.items.get(itemId);
		if (!entry) return;
		await restoreCalendarItemRevision(entry.item.calendarId, itemId, rev, entry.rev);
		await this.#reloadItem(entry.item.calendarId, itemId);
	}

	async #reloadItem(calendarId: string, itemId: string): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId) return;
		try {
			const detail = await getCalendarItem(calendarId, itemId);
			const loaded = await this.#openItem(accountId, detail.item, false);
			this.items.set(itemId, loaded);
			const span = itemSpan(loaded.item);
			await this.#db.putItem({
				accountId,
				id: itemId,
				calendarId,
				row: detail.item,
				uid: loaded.item.uid,
				kind: loaded.item.kind,
				spanStart: span.start,
				spanEnd: span.end,
				pending: false
			});
			for (const st of detail.states) {
				const opened = await this.#openState(accountId, st);
				if (opened) this.states.set(`${itemId}:${st.accountId}`, opened);
				await this.#db.putState({ accountId, itemId: `${itemId}:${st.accountId}`, row: st });
			}
		} catch {
			this.items.delete(itemId);
			await this.#db.deleteItem(accountId, itemId);
		}
		this.revision += 1;
	}

	#kick(): void {
		if (!this.#leading || this.#replaying || this.halted) return;
		if (this.#replayTimer) {
			clearTimeout(this.#replayTimer);
			this.#replayTimer = null;
		}
		void this.#replay();
	}

	#schedule(delayMs: number): void {
		if (this.#replayTimer) clearTimeout(this.#replayTimer);
		this.#replayTimer = setTimeout(() => {
			this.#replayTimer = null;
			this.#kick();
		}, delayMs);
	}

	#replayApi(): ReplayApi {
		return {
			putItem: putCalendarItem,
			deleteItem: (calendarId, itemId, baseRev) => apiDeleteItem(calendarId, itemId, baseRev),
			putState: putCalendarItemState,
			patchCalendar: updateCalendar,
			deleteCalendar: apiDeleteCalendar,
			sendMail: async (mail) => {
				await dispatchSend({
					to: mail.to,
					subject: mail.subject,
					body: mail.body,
					calendar: { method: mail.method, ics: mail.ics },
					fromEmail: mail.fromEmail,
					fromName: mail.fromName,
					fromAliasId: mail.fromAliasId,
					inReplyToMessageId: mail.inReplyToMessageId,
					inReplyToHeader: mail.inReplyToHeader,
					references: mail.references
				});
			}
		};
	}

	async #replay(): Promise<void> {
		const accountId = this.#accountId;
		if (!accountId || this.#replaying) return;
		this.#replaying = true;
		try {
			for (;;) {
				const rows = await this.#db.outbox(accountId);
				if (this.#accountId !== accountId) return;
				const next = rows.find((r) => r.status === 'queued');
				if (!next) break;
				const sending: OutboxRecord = { ...next, status: 'sending' };
				await this.#db.updateOutbox(sending);
				const result = await replayOne(sending, this.#replayApi(), {
					applied: async (rec, res) => {
						await this.#db.removeOutbox(rec.seq);
						await this.#applyResult(accountId, rec, res);
					},
					rebase: (rec) => this.#rebase(accountId, rec),
					dropped: async (rec, cls, message) => {
						await this.#db.removeOutbox(rec.seq);
						if (rec.op.kind === 'item.put' || rec.op.kind === 'item.delete') {
							await this.#reloadItem(rec.op.calendarId, rec.op.itemId);
						}
						this.lastDropped = { label: rec.op.label, cls, message };
					}
				});
				if (this.#accountId !== accountId) return;
				if (result.outcome === 'applied' || result.outcome === 'dropped') {
					this.#noteOnline();
					await this.#loadQueue();
					postCalendarMessage({ type: 'queue', accountId });
					continue;
				}
				if (result.outcome === 'blocked') {
					await this.#db.updateOutbox({ ...sending, status: 'blocked', lastError: result.message });
					await this.#loadQueue();
					continue;
				}
				if (result.outcome === 'halt') {
					await this.#db.updateOutbox({ ...sending, status: 'queued' });
					this.halted = result.message;
					await this.#loadQueue();
					break;
				}
				await this.#db.updateOutbox({
					...sending,
					status: 'queued',
					attempts: sending.attempts + 1,
					lastError: undefined
				});
				await this.#loadQueue();
				if (result.offline) this.#noteOffline();
				this.#schedule(result.delayMs);
				break;
			}
		} finally {
			this.#replaying = false;
		}
	}

	lastDropped = $state<{ label: string; cls: string; message: string } | null>(null);

	async #applyResult(accountId: string, rec: OutboxRecord, res: unknown): Promise<void> {
		if (rec.op.kind === 'item.put') {
			const itemId = rec.op.itemId;
			const summary = res as { rev: number; updatedAt: string };
			const entry = this.items.get(itemId);
			const stillPending = this.queue.some(
				(q) => q.seq !== rec.seq && q.op.kind === 'item.put' && q.op.itemId === itemId
			);
			if (entry) {
				this.items.set(itemId, {
					...entry,
					rev: summary.rev,
					updatedAt: summary.updatedAt,
					pending: stillPending
				});
				const cached = (await this.#db.items(accountId)).find((i) => i.id === itemId);
				if (cached) {
					await this.#db.putItem({
						...cached,
						row: { ...cached.row, rev: summary.rev, updatedAt: summary.updatedAt },
						pending: stillPending
					});
				}
				this.revision += 1;
			}
		}
	}

	async #rebase(accountId: string, rec: OutboxRecord): Promise<OutboxRecord | null> {
		if (rec.op.kind !== 'item.put') return null;
		try {
			const detail = await getCalendarItem(rec.op.calendarId, rec.op.itemId);
			const server = parseItem(
				await openText(accountId, detail.item.sealed, detail.item.keyFingerprint)
			);
			const local = parseItem(
				await openText(accountId, rec.op.body.sealed, rec.op.body.keyFingerprint)
			);
			const merged: CalendarItem = { ...server, updatedAt: new Date().toISOString() };
			for (const field of rec.op.fields ?? []) {
				if (field === 'done') merged.done = local.done;
				if (field === 'reminders') merged.reminders = local.reminders;
				if (field === 'partstat' && local.attendees) {
					merged.attendees = (server.attendees ?? []).map((a) => {
						const mine = local.attendees?.find(
							(l) => l.email.toLowerCase() === a.email.toLowerCase()
						);
						return mine ? { ...a, partstat: mine.partstat } : a;
					});
				}
			}
			const { sealed, key } = await this.#sealItem(accountId, merged);
			const entry = this.items.get(rec.op.itemId);
			if (entry) this.items.set(rec.op.itemId, { ...entry, item: merged, rev: detail.item.rev });
			return {
				...rec,
				op: {
					...rec.op,
					body: {
						...rec.op.body,
						baseRev: detail.item.rev,
						sealed,
						keyFingerprint: key.fingerprintB64,
						busyWindows: busyWindows(merged),
						privacy: merged.privacy
					}
				}
			};
		} catch {
			return null;
		}
	}

	#noteOnline(): void {
		this.online = true;
		this.offlineSince = null;
	}

	#noteOffline(): void {
		if (this.online) this.offlineSince = Date.now();
		this.online = false;
	}

	#noteFailure(err: unknown): void {
		if (
			err instanceof TypeError ||
			(typeof navigator !== 'undefined' && navigator.onLine === false)
		) {
			this.#noteOffline();
		}
	}

	defaultPrivacy(calendarId?: string): Privacy {
		const cal = calendarId ? this.calendar(calendarId) : this.defaultCalendar;
		return cal?.meta?.defaultPrivacy ?? accountSettings.calendar.defaultPrivacy;
	}
}

export const calendarStore = new CalendarStore();
