import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupAccount, stored, policy } = vi.hoisted(() => ({
	lookupAccount: vi.fn(async (email: string, since?: number) => ({ email, since })),
	stored: vi.fn(),
	policy: { value: { origin: 'thelemail.com/keys' } as { origin: string } | null }
}));

vi.mock('$core/api/accounts', () => ({ lookupAccount }));
vi.mock('./tlog/policy', () => ({
	get TLOG_POLICY() {
		return policy.value;
	}
}));
vi.mock('./tlog/state-idb', () => ({ tlogStateStore: { get: stored } }));

import { lookupDirectory } from './lookup';

describe('lookupDirectory', () => {
	beforeEach(() => {
		lookupAccount.mockClear();
		stored.mockReset();
		policy.value = { origin: 'thelemail.com/keys' };
	});

	it('sends the accepted tree size for the pinned log', async () => {
		stored.mockResolvedValue({ origin: 'thelemail.com/keys', treeSize: 84 });
		await lookupDirectory('bob@thelemail.com');
		expect(stored).toHaveBeenCalledWith('thelemail.com/keys');
		expect(lookupAccount).toHaveBeenCalledWith('bob@thelemail.com', 84);
	});

	it('sends no tree size before any checkpoint was accepted', async () => {
		stored.mockResolvedValue(null);
		await lookupDirectory('bob@thelemail.com');
		expect(lookupAccount).toHaveBeenCalledWith('bob@thelemail.com', undefined);
	});

	it('still looks up when the state store cannot be read', async () => {
		stored.mockRejectedValue(new Error('idb blocked'));
		await lookupDirectory('bob@thelemail.com');
		expect(lookupAccount).toHaveBeenCalledWith('bob@thelemail.com', undefined);
	});

	it('does not read log state when no policy is pinned', async () => {
		policy.value = null;
		await lookupDirectory('bob@thelemail.com');
		expect(stored).not.toHaveBeenCalled();
		expect(lookupAccount).toHaveBeenCalledWith('bob@thelemail.com', undefined);
	});
});
