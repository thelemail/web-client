import {
	listCalendarChanges,
	listCalendarItems,
	listCalendars,
	type CalendarChangesResponse,
	type CalendarItemRow,
	type CalendarItemStateRow,
	type CalendarRow
} from '$core/api/calendars';
import type { CachedCalendar, CachedItem, CachedState, CalendarDb } from './db';

export interface SyncApi {
	listCalendars: typeof listCalendars;
	listCalendarItems: typeof listCalendarItems;
	listCalendarChanges: typeof listCalendarChanges;
}

export const liveSyncApi: SyncApi = { listCalendars, listCalendarItems, listCalendarChanges };

export interface FullLoadResult {
	calendars: CachedCalendar[];
	items: CachedItem[];
	states: CachedState[];
	cursor: string;
}

export interface DeltaResult {
	changed: boolean;
	resync: boolean;
	cursor: string | null;
	calendarsTouched: boolean;
	itemIds: string[];
	removedItemIds: string[];
	states: CalendarItemStateRow[];
}

const PAGE = 200;

function cacheCalendar(accountId: string, row: CalendarRow): CachedCalendar {
	return { accountId, id: row.id, row };
}

function cacheItem(accountId: string, row: CalendarItemRow, previous?: CachedItem): CachedItem {
	return {
		accountId,
		id: row.id,
		calendarId: row.calendarId,
		row,
		uid: previous?.uid,
		kind: previous?.kind,
		spanStart: previous?.spanStart,
		spanEnd: previous?.spanEnd,
		pending: previous?.pending
	};
}

function cacheState(accountId: string, row: CalendarItemStateRow): CachedState {
	return { accountId, itemId: `${row.itemId}:${row.accountId}`, row };
}

export async function fullLoad(
	accountId: string,
	api: SyncApi,
	db: CalendarDb
): Promise<FullLoadResult> {
	const cold = await api.listCalendarChanges();
	const { calendars } = await api.listCalendars();
	const items: CachedItem[] = [];
	const states: CachedState[] = [];
	for (const cal of calendars) {
		let cursor: string | undefined;
		for (;;) {
			const page = await api.listCalendarItems(cal.id, { limit: PAGE, cursor });
			for (const row of page.items) items.push(cacheItem(accountId, row));
			for (const st of page.states ?? []) states.push(cacheState(accountId, st));
			if (!page.nextCursor) break;
			cursor = page.nextCursor;
		}
	}
	await db.clear(accountId);
	for (const cal of calendars) await db.putCalendar(cacheCalendar(accountId, cal));
	await db.putItems(items);
	for (const st of states) await db.putState(st);
	await db.putSync({ accountId, cursor: cold.nextCursor, lastSyncAt: Date.now(), loaded: true });
	return {
		calendars: calendars.map((c) => cacheCalendar(accountId, c)),
		items,
		states,
		cursor: cold.nextCursor
	};
}

export async function applyPage(
	accountId: string,
	db: CalendarDb,
	page: CalendarChangesResponse
): Promise<DeltaResult> {
	const result: DeltaResult = {
		changed: false,
		resync: page.resyncRequired,
		cursor: page.nextCursor,
		calendarsTouched: false,
		itemIds: [],
		removedItemIds: [],
		states: []
	};
	if (page.resyncRequired) return result;
	const accessible = new Set(page.accessibleCalendarIds);
	const known = await db.calendars(accountId);
	for (const cal of known) {
		if (!accessible.has(cal.id)) {
			await db.deleteCalendar(accountId, cal.id);
			result.calendarsTouched = true;
			result.changed = true;
		}
	}
	for (const change of page.calendars) {
		result.calendarsTouched = true;
		result.changed = true;
		if (change.deleted || !change.calendar) {
			await db.deleteCalendar(accountId, change.id);
		} else {
			await db.putCalendar(cacheCalendar(accountId, change.calendar));
		}
	}
	if (page.items.length) {
		const existing = new Map((await db.items(accountId)).map((i) => [i.id, i]));
		for (const change of page.items) {
			if (existing.get(change.id)?.pending) continue;
			result.changed = true;
			if (change.deleted || !change.item) {
				await db.deleteItem(accountId, change.id);
				result.removedItemIds.push(change.id);
			} else {
				await db.putItem(cacheItem(accountId, change.item, existing.get(change.id)));
				result.itemIds.push(change.id);
			}
		}
	}
	for (const st of page.states) {
		result.changed = true;
		await db.putState(cacheState(accountId, st));
		result.states.push(st);
	}
	if (result.calendarsTouched) {
		const liveCalendars = new Set((await db.calendars(accountId)).map((c) => c.id));
		for (const it of await db.items(accountId)) {
			if (!liveCalendars.has(it.calendarId)) {
				await db.deleteItem(accountId, it.id);
				result.removedItemIds.push(it.id);
			}
		}
	}
	return result;
}

export async function pullChanges(
	accountId: string,
	api: SyncApi,
	db: CalendarDb,
	cursor: string
): Promise<DeltaResult> {
	const merged: DeltaResult = {
		changed: false,
		resync: false,
		cursor,
		calendarsTouched: false,
		itemIds: [],
		removedItemIds: [],
		states: []
	};
	let next = cursor;
	for (let guard = 0; guard < 50; guard++) {
		const page = await api.listCalendarChanges(next);
		const applied = await applyPage(accountId, db, page);
		if (applied.resync) {
			merged.resync = true;
			return merged;
		}
		merged.changed ||= applied.changed;
		merged.calendarsTouched ||= applied.calendarsTouched;
		merged.itemIds.push(...applied.itemIds);
		merged.removedItemIds.push(...applied.removedItemIds);
		merged.states.push(...applied.states);
		next = page.nextCursor;
		merged.cursor = next;
		if (!page.hasMore) break;
	}
	await db.putSync({ accountId, cursor: merged.cursor, lastSyncAt: Date.now(), loaded: true });
	return merged;
}
