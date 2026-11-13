import { beforeEach, describe, expect, it, vi } from 'vitest';

const listDrafts = vi.fn();
const listScheduledSends = vi.fn();
const cancelScheduledSend = vi.fn();

vi.mock('$core/api/drafts', () => ({ listDrafts: (...a: unknown[]) => listDrafts(...a) }));
vi.mock('$core/api/scheduledSends', () => ({
	listScheduledSends: (...a: unknown[]) => listScheduledSends(...a),
	cancelScheduledSend: (...a: unknown[]) => cancelScheduledSend(...a)
}));
vi.mock('$core/mail/decrypt', () => ({
	decryptPreview: vi.fn(async () => ({
		sender: { display: 'Me', address: 'me@thelemail.test' },
		recipients: [{ kind: 'to', address: 'you@example.test' }],
		subject: 'Draft',
		snippet: ''
	})),
	DecryptionError: class DecryptionError extends Error {}
}));
const authState = vi.hoisted(() => ({ canEnterApp: true, accountId: 'acc-1' as string | null }));
vi.mock('./auth.svelte', () => ({ auth: authState }));
vi.mock('./mailbox.svelte', () => ({ mailbox: { refreshCounts: vi.fn() } }));

import { drafts } from './drafts.svelte';
import { scheduled } from './scheduled.svelte';
import { accountTransition } from './accountTransition.svelte';

function draftItem(id: string) {
	return { id, encryptedPreview: `enc-${id}`, updatedAt: '2026-11-01T10:00:00Z', attachmentCount: 0 };
}

function scheduledItem(id: string) {
	return {
		id,
		kind: 'send',
		encryptedPreview: `enc-${id}`,
		scheduledAt: '2026-12-01T10:00:00Z',
		createdAt: '2026-11-01T10:00:00Z'
	};
}

beforeEach(() => {
	listDrafts.mockReset();
	listScheduledSends.mockReset();
	cancelScheduledSend.mockReset();
	authState.accountId = 'acc-1';
	drafts.setAccount(null);
	drafts.setAccount('acc-1');
	scheduled.setAccount(null);
	scheduled.setAccount('acc-1');
});

describe('drafts across an account switch', () => {
	it('loads the new account even while the old account was still loading', async () => {
		const old = Promise.withResolvers<unknown>();
		listDrafts.mockReturnValueOnce(old.promise);
		const first = drafts.ensureLoaded();
		expect(drafts.loading).toBe(true);

		drafts.setAccount('acc-2');
		authState.accountId = 'acc-2';
		expect(drafts.loading).toBe(false);
		listDrafts.mockResolvedValueOnce({ items: [draftItem('d2')], nextCursor: null });
		await drafts.ensureLoaded();
		old.resolve({ items: [draftItem('d1')], nextCursor: null });
		await first;

		expect(drafts.items.map((d) => d.id)).toEqual(['d2']);
		expect(drafts.loaded).toBe(true);
	});

	it('still loads the list after a draft was saved locally first', async () => {
		drafts.upsertLocal({ id: 'local', subject: 'x' } as never);
		listDrafts.mockResolvedValueOnce({ items: [draftItem('d1'), draftItem('local')], nextCursor: null });
		await drafts.ensureLoaded();
		expect(listDrafts).toHaveBeenCalledTimes(1);
	});
});

describe('scheduled across an account switch', () => {
	it('loads the new account even while the old account was still loading', async () => {
		const old = Promise.withResolvers<unknown>();
		listScheduledSends.mockReturnValueOnce(old.promise);
		const first = scheduled.ensureLoaded();

		scheduled.setAccount('acc-2');
		authState.accountId = 'acc-2';
		listScheduledSends.mockResolvedValueOnce({ items: [scheduledItem('s2')] });
		await scheduled.ensureLoaded();
		old.resolve({ items: [scheduledItem('s1')] });
		await first;

		expect(scheduled.items.map((s) => s.id)).toEqual(['s2']);
	});

	it('does not bring back a send cancelled while a refresh was in flight', async () => {
		listScheduledSends.mockResolvedValueOnce({ items: [scheduledItem('s1')] });
		await scheduled.ensureLoaded();
		const gate = Promise.withResolvers<unknown>();
		listScheduledSends.mockReturnValueOnce(gate.promise);
		const refresh = scheduled.refresh();
		cancelScheduledSend.mockResolvedValueOnce(undefined);
		await scheduled.cancel('s1');
		gate.resolve({ items: [scheduledItem('s1')] });
		await refresh;

		expect(scheduled.items).toEqual([]);
	});
});

describe('account transition', () => {
	it('shows while the switch runs and clears even when it fails', async () => {
		const gate = Promise.withResolvers<void>();
		const run = accountTransition.run('switch', 'b@thelemail.test', () => gate.promise);
		expect(accountTransition.current).toEqual({ kind: 'switch', address: 'b@thelemail.test' });
		gate.reject(new Error('nope'));
		await expect(run).rejects.toThrow('nope');
		expect(accountTransition.current).toBeNull();
	});
});
