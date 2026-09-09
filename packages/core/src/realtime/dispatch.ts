import { mailbox } from '$core/stores/mailbox.svelte';
import { unread } from '$core/stores/unread.svelte';
import { drafts } from '$core/stores/drafts.svelte';
import { scheduled } from '$core/stores/scheduled.svelte';
import { addresses } from '$core/stores/addresses.svelte';
import { signatures } from '$core/stores/signatures.svelte';
import { accountSettings } from '$core/stores/accountSettings.svelte';
import { mailSearch } from '$core/stores/search.svelte';
import { auth } from '$core/stores/auth.svelte';
import { coalesce } from './coalesce';
import { notifyCalendarHint, notifyCalendarMessage } from './calendarHook';
import type { RealtimeHint } from './types';

const COALESCE_WINDOW_MS = 750;

const refreshCountsCoalesced = coalesce(() => {
	void mailbox.refreshCounts();
}, COALESCE_WINDOW_MS);

const refreshLoadedCoalesced = coalesce(() => {
	void mailbox.refreshLoaded();
}, COALESCE_WINDOW_MS);

const refreshDraftsCoalesced = coalesce(() => {
	void drafts.refresh();
}, COALESCE_WINDOW_MS);

const refreshScheduledCoalesced = coalesce(() => {
	void scheduled.refresh();
}, COALESCE_WINDOW_MS);

const refreshSearchIndexCoalesced = coalesce(() => {
	void mailSearch.refresh();
}, COALESCE_WINDOW_MS);

function entityOf(kind: string): string {
	const dot = kind.indexOf('.');
	return dot < 0 ? kind : kind.slice(0, dot);
}

export function applyHint(hint: RealtimeHint): void {
	const isActive = hint.accountId === auth.accountId;
	const entity = entityOf(hint.kind);

	switch (entity) {
		case 'message':
		case 'thread':
			if (isActive) {
				mailbox.applyRealtime(hint);
				refreshCountsCoalesced();
				refreshSearchIndexCoalesced();
				if (hint.kind === 'message.created') notifyCalendarMessage(hint);
			} else {
				void unread.refresh(hint.accountId);
			}
			return;
		case 'mailbox':
			if (isActive) {
				refreshLoadedCoalesced();
				refreshCountsCoalesced();
				refreshSearchIndexCoalesced();
			} else {
				void unread.refresh(hint.accountId);
			}
			return;
		case 'draft':
			if (isActive) refreshDraftsCoalesced();
			return;
		case 'scheduled_send':
			if (isActive) refreshScheduledCoalesced();
			return;
		case 'address':
			if (isActive) void addresses.load();
			return;
		case 'signature':
			if (isActive) void signatures.load();
			return;
		case 'settings':
			if (isActive) void accountSettings.refresh();
			return;
		case 'lifecycle':
		case 'subscription':
			void auth.loadProfile(hint.accountId);
			return;
		case 'calendar':
		case 'calendar_item':
			if (isActive) notifyCalendarHint(hint);
			return;
		default:
			return;
	}
}
