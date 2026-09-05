import { apiFetch } from './client';

export type CalendarKind = 'personal' | 'shared' | 'role';
export type CalendarRole = 'owner' | 'editor' | 'viewer';
export type CalendarPrivacy = 'private' | 'busy' | 'shared';

export interface BusyWindow {
	startsAt: string;
	endsAt: string;
}

export interface CalendarMember {
	accountId: string;
	email: string;
	fullName: string;
	role: CalendarRole;
	grantedKeyVersion: number;
	addedAt: string;
}

export interface CalendarRow {
	id: string;
	workspaceId: string;
	kind: CalendarKind;
	ownerAccountId: string;
	sharedAliasId?: string | null;
	keyVersion: number;
	keyFingerprint?: string | null;
	sealedMeta: string;
	metaKeyFingerprint: string;
	metaSchemaVersion: number;
	rev: number;
	callerRole?: CalendarRole | null;
	memberCount: number;
	rotationRequired: boolean;
	members: CalendarMember[];
	createdAt: string;
	updatedAt: string;
}

export interface CalendarMemberGrant {
	accountId: string;
	role: CalendarRole;
	memberKeyFingerprint: string;
	wrappedPrivateKey: string;
}

export interface CreateCalendarRequest {
	kind: CalendarKind;
	sealedMeta: string;
	metaKeyFingerprint: string;
	metaSchemaVersion: number;
	calendarPublicKeyArmored?: string;
	keyAlgorithm?: string;
	sharedAliasId?: string;
	members?: CalendarMemberGrant[];
}

export interface UpdateCalendarRequest {
	sealedMeta: string;
	metaKeyFingerprint: string;
	metaSchemaVersion: number;
	baseRev: number;
}

export interface RotateCalendarMembersRequest {
	calendarPublicKeyArmored: string;
	keyAlgorithm: string;
	members: CalendarMemberGrant[];
}

export interface CalendarKeyGrant {
	calendarId: string;
	keyVersion: number;
	calendarKeyFingerprint: string;
	calendarPublicKeyArmored: string;
	wrappedPrivateKey: string;
	isCurrent: boolean;
}

export interface CalendarItemRow {
	id: string;
	calendarId: string;
	rev: number;
	privacy: CalendarPrivacy;
	sealed: string;
	keyFingerprint: string;
	schemaVersion: number;
	createdById?: string | null;
	updatedById?: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt?: string | null;
}

export interface CalendarItemRequest {
	baseRev: number;
	privacy: CalendarPrivacy;
	sealed: string;
	keyFingerprint: string;
	schemaVersion: number;
	busyWindows: BusyWindow[];
	busySignature?: string;
	busySignerKeyFingerprint?: string;
}

export interface CalendarItemSummary {
	id: string;
	rev: number;
	updatedAt: string;
}

export interface CalendarItemStateRow {
	itemId: string;
	calendarId?: string | null;
	accountId: string;
	sealed: string;
	keyFingerprint: string;
	schemaVersion: number;
	rev: number;
	updatedAt: string;
}

export interface CalendarItemStateRequest {
	sealed: string;
	keyFingerprint: string;
	schemaVersion: number;
}

export interface CalendarItemRevisionRow {
	rev: number;
	sealed: string;
	keyFingerprint: string;
	schemaVersion: number;
	privacy: CalendarPrivacy;
	deleted: boolean;
	updatedById?: string | null;
	createdAt: string;
}

export interface CalendarBusyItem {
	itemId: string;
	rev: number;
	privacy: CalendarPrivacy;
	signerAccountId: string;
	signerKeyFingerprint: string;
	signature: string;
	windows: BusyWindow[];
}

export interface CalendarBusyEntry {
	calendarId: string;
	kind: CalendarKind;
	ownerAccountId: string;
	items: CalendarBusyItem[];
}

export interface CalendarChange {
	id: string;
	updatedAt: string;
	deleted: boolean;
	calendar?: CalendarRow | null;
}

export interface CalendarItemChange {
	id: string;
	calendarId: string;
	updatedAt: string;
	deleted: boolean;
	item?: CalendarItemRow | null;
}

export interface CalendarChangesResponse {
	calendars: CalendarChange[];
	items: CalendarItemChange[];
	states: CalendarItemStateRow[];
	accessibleCalendarIds: string[];
	nextCursor: string;
	hasMore: boolean;
	resyncRequired: boolean;
	watermark: string;
}

function calendarPath(calendarId: string, suffix = ''): string {
	return `/v1/calendars/${encodeURIComponent(calendarId)}${suffix}`;
}

function itemPath(calendarId: string, itemId: string, suffix = ''): string {
	return calendarPath(calendarId, `/items/${encodeURIComponent(itemId)}${suffix}`);
}

export function listCalendars(): Promise<{ calendars: CalendarRow[] }> {
	return apiFetch('/v1/calendars');
}

export function createCalendar(body: CreateCalendarRequest): Promise<CalendarRow> {
	return apiFetch('/v1/calendars', { method: 'POST', body });
}

export function getCalendar(calendarId: string): Promise<CalendarRow> {
	return apiFetch(calendarPath(calendarId));
}

export function updateCalendar(
	calendarId: string,
	body: UpdateCalendarRequest
): Promise<CalendarRow> {
	return apiFetch(calendarPath(calendarId), { method: 'PATCH', body });
}

export function deleteCalendar(calendarId: string): Promise<void> {
	return apiFetch(calendarPath(calendarId), { method: 'DELETE' });
}

export function rotateCalendarMembers(
	calendarId: string,
	body: RotateCalendarMembersRequest
): Promise<CalendarRow> {
	return apiFetch(calendarPath(calendarId, '/members'), {
		method: 'PUT',
		body
	});
}

export function updateCalendarMemberRole(
	calendarId: string,
	accountId: string,
	role: CalendarRole
): Promise<CalendarRow> {
	return apiFetch(calendarPath(calendarId, `/members/${encodeURIComponent(accountId)}`), {
		method: 'PATCH',
		body: { role }
	});
}

export function listMyCalendarKeys(): Promise<{ keys: CalendarKeyGrant[] }> {
	return apiFetch('/v1/me/calendar-keys');
}

export interface ListCalendarItemsOptions {
	limit?: number;
	cursor?: string;
	includeDeleted?: boolean;
}

export function listCalendarItems(
	calendarId: string,
	opts: ListCalendarItemsOptions = {}
): Promise<{
	items: CalendarItemRow[];
	states?: CalendarItemStateRow[];
	nextCursor?: string | null;
}> {
	const params = new URLSearchParams();
	if (opts.limit) params.set('limit', String(opts.limit));
	if (opts.cursor) params.set('cursor', opts.cursor);
	if (opts.includeDeleted) params.set('includeDeleted', 'true');
	const qs = params.toString();
	return apiFetch(calendarPath(calendarId, qs ? `/items?${qs}` : '/items'));
}

export function putCalendarItem(
	calendarId: string,
	itemId: string,
	body: CalendarItemRequest
): Promise<CalendarItemSummary> {
	return apiFetch(itemPath(calendarId, itemId), { method: 'PUT', body });
}

export function getCalendarItem(
	calendarId: string,
	itemId: string
): Promise<{ item: CalendarItemRow; states: CalendarItemStateRow[] }> {
	return apiFetch(itemPath(calendarId, itemId));
}

export function deleteCalendarItem(
	calendarId: string,
	itemId: string,
	baseRev?: number
): Promise<void> {
	const suffix = baseRev ? `?baseRev=${baseRev}` : '';
	return apiFetch(itemPath(calendarId, itemId, suffix), { method: 'DELETE' });
}

export function putCalendarItemState(
	calendarId: string,
	itemId: string,
	body: CalendarItemStateRequest
): Promise<CalendarItemStateRow> {
	return apiFetch(itemPath(calendarId, itemId, '/state'), {
		method: 'PUT',
		body
	});
}

export function listCalendarItemRevisions(
	calendarId: string,
	itemId: string
): Promise<{ revisions: CalendarItemRevisionRow[] }> {
	return apiFetch(itemPath(calendarId, itemId, '/revisions'));
}

export interface RestoreCalendarItemRevisionRequest {
	baseRev: number;
	privacy: CalendarPrivacy;
	busyWindows: BusyWindow[];
	busySignature?: string;
	busySignerKeyFingerprint?: string;
}

export function restoreCalendarItemRevision(
	calendarId: string,
	itemId: string,
	rev: number,
	body: RestoreCalendarItemRevisionRequest
): Promise<CalendarItemSummary> {
	return apiFetch(itemPath(calendarId, itemId, `/revisions/${rev}/restore`), {
		method: 'POST',
		body
	});
}

export function listCalendarBusy(
	from: string,
	to: string,
	calendars?: string[]
): Promise<{ calendars: CalendarBusyEntry[] }> {
	const params = new URLSearchParams({ from, to });
	if (calendars?.length) params.set('calendars', calendars.join(','));
	return apiFetch(`/v1/calendar/busy?${params.toString()}`);
}

export function listCalendarChanges(
	cursor?: string,
	limit?: number
): Promise<CalendarChangesResponse> {
	const params = new URLSearchParams();
	if (cursor) params.set('cursor', cursor);
	if (limit) params.set('limit', String(limit));
	const qs = params.toString();
	return apiFetch(qs ? `/v1/calendar/changes?${qs}` : '/v1/calendar/changes');
}
