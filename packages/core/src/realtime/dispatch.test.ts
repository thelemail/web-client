import { describe, it, expect, vi, beforeEach } from 'vitest';

const mailboxApplyRealtime = vi.fn();
const mailboxRefreshCounts = vi.fn();
const mailboxRefreshLoaded = vi.fn();
vi.mock('$core/stores/mailbox.svelte', () => ({
	mailbox: {
		applyRealtime: (...a: unknown[]) => mailboxApplyRealtime(...a),
		refreshCounts: (...a: unknown[]) => mailboxRefreshCounts(...a),
		refreshLoaded: (...a: unknown[]) => mailboxRefreshLoaded(...a)
	}
}));

const unreadRefresh = vi.fn();
vi.mock('$core/stores/unread.svelte', () => ({
	unread: { refresh: (...a: unknown[]) => unreadRefresh(...a) }
}));

const draftsRefresh = vi.fn();
vi.mock('$core/stores/drafts.svelte', () => ({
	drafts: { refresh: (...a: unknown[]) => draftsRefresh(...a) }
}));

const scheduledRefresh = vi.fn();
vi.mock('$core/stores/scheduled.svelte', () => ({
	scheduled: { refresh: (...a: unknown[]) => scheduledRefresh(...a) }
}));

const addressesLoad = vi.fn();
vi.mock('$core/stores/addresses.svelte', () => ({
	addresses: { load: (...a: unknown[]) => addressesLoad(...a) }
}));

const signaturesLoad = vi.fn();
vi.mock('$core/stores/signatures.svelte', () => ({
	signatures: { load: (...a: unknown[]) => signaturesLoad(...a) }
}));

const accountSettingsRefresh = vi.fn();
vi.mock('$core/stores/accountSettings.svelte', () => ({
	accountSettings: { refresh: (...a: unknown[]) => accountSettingsRefresh(...a) }
}));

const aliasKeysLoad = vi.fn();
vi.mock('$core/stores/aliasKeys.svelte', () => ({
	aliasKeys: { load: (...a: unknown[]) => aliasKeysLoad(...a) }
}));

const replyPresenceHint = vi.fn();
vi.mock('$core/stores/replyPresence.svelte', () => ({
	replyPresence: { onHint: (...a: unknown[]) => replyPresenceHint(...a) }
}));

const mailCollectionsHint = vi.fn(async (_h: unknown) => false);
vi.mock('$core/stores/mailCollections.svelte', () => ({
	mailCollections: { applyHint: (h: unknown) => mailCollectionsHint(h) }
}));

const authState = vi.hoisted(() => ({ accountId: 'acc-1' as string | null }));
const authLoadProfile = vi.fn();
vi.mock('$core/stores/auth.svelte', () => ({
	auth: {
		get accountId() {
			return authState.accountId;
		},
		loadProfile: (...a: unknown[]) => authLoadProfile(...a)
	}
}));

import { applyHint } from './dispatch';
import type { RealtimeHint } from './types';

function hint(overrides: Partial<RealtimeHint> = {}): RealtimeHint {
	return { accountId: 'acc-1', kind: 'message.created', id: 'm1', ...overrides };
}

describe('applyHint', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		authState.accountId = 'acc-1';
	});

	it('routes message hints for the active account to mailbox and counts', () => {
		applyHint(hint({ kind: 'message.updated' }));
		expect(mailboxApplyRealtime).toHaveBeenCalledTimes(1);
	});

	it('routes thread hints the same way as message hints', () => {
		applyHint(hint({ kind: 'thread.updated' }));
		expect(mailboxApplyRealtime).toHaveBeenCalledTimes(1);
	});

	it('routes mailbox.invalidated to a full reload, not per-item apply', () => {
		applyHint(hint({ kind: 'mailbox.invalidated', id: undefined }));
		expect(mailboxApplyRealtime).not.toHaveBeenCalled();
	});

	it('routes a background-account message hint only to unread, never mailbox', () => {
		applyHint(hint({ accountId: 'acc-2', kind: 'message.created' }));
		expect(mailboxApplyRealtime).not.toHaveBeenCalled();
		expect(unreadRefresh).toHaveBeenCalledWith('acc-2');
	});

	it('routes draft hints to drafts.refresh for the active account only', async () => {
		vi.useFakeTimers();
		try {
			applyHint(hint({ kind: 'draft.updated' }));
			applyHint(hint({ accountId: 'acc-2', kind: 'draft.updated' }));
			await vi.advanceTimersByTimeAsync(1000);
			expect(draftsRefresh).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('routes address hints to addresses.load for the active account', () => {
		applyHint(hint({ kind: 'address.updated' }));
		expect(addressesLoad).toHaveBeenCalledTimes(1);
	});

	it('refreshes the profile, not the address list, for a background account address hint', () => {
		applyHint(hint({ accountId: 'acc-2', kind: 'address.updated' }));
		expect(addressesLoad).not.toHaveBeenCalled();
		expect(authLoadProfile).toHaveBeenCalledWith('acc-2');
	});

	it('routes signature hints to signatures.load', () => {
		applyHint(hint({ kind: 'signature.updated' }));
		expect(signaturesLoad).toHaveBeenCalledTimes(1);
	});

	it('routes settings hints to accountSettings.refresh', () => {
		applyHint(hint({ kind: 'settings.updated' }));
		expect(accountSettingsRefresh).toHaveBeenCalledTimes(1);
	});

	it('routes lifecycle and subscription hints to auth.loadProfile regardless of active account', () => {
		applyHint(hint({ kind: 'lifecycle.updated' }));
		applyHint(hint({ accountId: 'acc-2', kind: 'subscription.updated' }));
		expect(authLoadProfile).toHaveBeenCalledWith('acc-1');
		expect(authLoadProfile).toHaveBeenCalledWith('acc-2');
	});

	it('reloads addresses and alias keys when a shared address changes', () => {
		applyHint(hint({ kind: 'shared_alias.updated', id: 'alias-1' }));
		expect(addressesLoad).toHaveBeenCalledTimes(1);
		expect(aliasKeysLoad).toHaveBeenCalledWith('acc-1');
	});

	it('ignores a shared address change on a background account', () => {
		applyHint(hint({ accountId: 'acc-2', kind: 'shared_alias.updated', id: 'alias-1' }));
		expect(addressesLoad).not.toHaveBeenCalled();
		expect(aliasKeysLoad).not.toHaveBeenCalled();
	});

	it('routes reply presence hints for the active account to the presence store', () => {
		const h = hint({ kind: 'reply_presence.updated', id: 'm9', thread_id: 't9' });
		applyHint(h);
		applyHint(hint({ accountId: 'acc-2', kind: 'reply_presence.updated' }));
		expect(replyPresenceHint).toHaveBeenCalledTimes(1);
		expect(replyPresenceHint).toHaveBeenCalledWith(h);
		expect(mailboxApplyRealtime).not.toHaveBeenCalled();
	});

	it('reloads the folder and label registry for the active account only', () => {
		applyHint(hint({ kind: 'mail_collection.updated', id: 'c1' }));
		applyHint(hint({ accountId: 'acc-2', kind: 'mail_collection.deleted', id: 'c2' }));
		expect(mailCollectionsHint).toHaveBeenCalledTimes(1);
		expect(mailboxApplyRealtime).not.toHaveBeenCalled();
	});

	it('refreshes open lists and counts when a folder or label change reshapes the tree', async () => {
		mailCollectionsHint.mockResolvedValueOnce(true);
		applyHint(hint({ kind: 'mail_collection.updated', id: 'c1', rev: 3 }));
		await vi.waitFor(() => {
			expect(mailboxRefreshLoaded).toHaveBeenCalled();
			expect(mailboxRefreshCounts).toHaveBeenCalled();
		});
	});

	it('does nothing for an unknown kind', () => {
		applyHint(hint({ kind: 'blocked_sender.created' }));
		expect(mailboxApplyRealtime).not.toHaveBeenCalled();
		expect(unreadRefresh).not.toHaveBeenCalled();
	});
});
