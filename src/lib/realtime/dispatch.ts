import { mailbox } from '$lib/stores/mailbox.svelte';
import { unread } from '$lib/stores/unread.svelte';
import { drafts } from '$lib/stores/drafts.svelte';
import { scheduled } from '$lib/stores/scheduled.svelte';
import { addresses } from '$lib/stores/addresses.svelte';
import { signatures } from '$lib/stores/signatures.svelte';
import { accountSettings } from '$lib/stores/accountSettings.svelte';
import { auth } from '$lib/stores/auth.svelte';
import { coalesce } from './coalesce';
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
			} else {
				void unread.refresh(hint.accountId);
			}
			return;
		case 'mailbox':
			if (isActive) {
				refreshLoadedCoalesced();
				refreshCountsCoalesced();
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
		default:
			return;
	}
}
