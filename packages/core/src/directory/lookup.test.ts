import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupAccount, stored, policy, seen } = vi.hoisted(() => ({
	lookupAccount: vi.fn(async (email: string, since?: number) => ({ email, since })),
	stored: vi.fn(),
	seen: vi.fn(),
	policy: { value: { origin: 'thelemail.com/keys' } as { origin: string } | null }
}));

vi.mock('$core/api/accounts', () => ({ lookupAccount }));
vi.mock('./tlog/policy', () => ({
	get TLOG_POLICY() {
		return policy.value;
	}
}));
vi.mock('./tlog/state-idb', () => ({ tlogStateStore: { get: stored } }));
vi.mock('./seen-idb', () => ({ getSeen: seen }));

import { lookupDirectory } from './lookup';

describe('lookupDirectory', () => {
	beforeEach(() => {
		lookupAccount.mockClear();
		stored.mockReset();
		seen.mockReset();
		seen.mockResolvedValue(null);
		policy.value = { origin: 'thelemail.com/keys' };
	});

	it('sends the accepted tree size for the pinned log', async () => {
		stored.mockResolvedValue({ origin: 'thelemail.com/keys', treeSize: 84 });
		await lookupDirectory('bob@thelemail.com');
		expect(stored).toHaveBeenCalledWith('thelemail.com/keys');
		expect(lookupAccount).toHaveBeenCalledWith('bob@thelemail.com', 84, undefined);
	});

	it('sends no tree size before any checkpoint was accepted', async () => {
		stored.mockResolvedValue(null);
		await lookupDirectory('bob@thelemail.com');
		expect(lookupAccount).toHaveBeenCalledWith('bob@thelemail.com', undefined, undefined);
	});

	it('still looks up when the state store cannot be read', async () => {
		stored.mockRejectedValue(new Error('idb blocked'));
		await lookupDirectory('bob@thelemail.com');
		expect(lookupAccount).toHaveBeenCalledWith('bob@thelemail.com', undefined, undefined);
	});

	it('does not read log state when no policy is pinned', async () => {
		policy.value = null;
		await lookupDirectory('bob@thelemail.com');
		expect(stored).not.toHaveBeenCalled();
		expect(lookupAccount).toHaveBeenCalledWith('bob@thelemail.com', undefined, undefined);
	});

	it('asks for the previous key behind the pinned fingerprint', async () => {
		stored.mockResolvedValue(null);
		seen.mockResolvedValue({ address: 'bob@thelemail.com', keyFingerprint: 'AB12', version: 3 });
		await lookupDirectory(' Bob@thelemail.com ');
		expect(seen).toHaveBeenCalledWith('bob@thelemail.com');
		expect(lookupAccount).toHaveBeenCalledWith(' Bob@thelemail.com ', undefined, 'ab12');
	});

	it('prefers an explicit previous fingerprint over the pin', async () => {
		stored.mockResolvedValue(null);
		seen.mockResolvedValue({ address: 'bob@thelemail.com', keyFingerprint: 'ab12', version: 3 });
		await lookupDirectory('bob@thelemail.com', { previousKeyFingerprint: 'cd34' });
		expect(lookupAccount).toHaveBeenCalledWith('bob@thelemail.com', undefined, 'cd34');
	});

	it('still looks up when the pin store cannot be read', async () => {
		stored.mockResolvedValue(null);
		seen.mockRejectedValue(new Error('idb blocked'));
		await lookupDirectory('bob@thelemail.com');
		expect(lookupAccount).toHaveBeenCalledWith('bob@thelemail.com', undefined, undefined);
	});
});
