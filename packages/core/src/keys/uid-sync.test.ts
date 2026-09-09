import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const calls = vi.hoisted(() => ({
	list: [] as (string | undefined)[],
	update: [] as { input: Record<string, unknown>; accountId: string | undefined }[],
	reformat: [] as { accountId: string; emails: string[] }[],
	commit: [] as { accountId: string; encryptedPrivateKey: string }[]
}));

const behaviour = vi.hoisted(() => ({
	addresses: {} as Record<string, string[]>,
	reformat: (_accountId: string, _emails: string[]): unknown => ({
		ok: true,
		unchanged: false,
		publicKeyArmored: 'pub',
		encryptedPrivateKey: 'enc'
	}),
	updateGate: null as null | { promise: Promise<void>; release: () => void }
}));

vi.mock('$core/api/addresses', () => ({
	listMyAddresses: async (accountId?: string) => {
		calls.list.push(accountId);
		return { addresses: (behaviour.addresses[accountId ?? ''] ?? []).map((email) => ({ email })) };
	}
}));

vi.mock('$core/api/me', () => ({
	updateKeys: async (input: Record<string, unknown>, accountId?: string) => {
		calls.update.push({ input, accountId });
		if (behaviour.updateGate) await behaviour.updateGate.promise;
		return {};
	}
}));

vi.mock('$core/keystore/keystore-client', () => ({
	keystore: {
		reformatKeyWithUids: async ({ accountId, emails }: { accountId: string; emails: string[] }) => {
			calls.reformat.push({ accountId, emails });
			return behaviour.reformat(accountId, emails);
		},
		commitReformattedKey: async (args: { accountId: string; encryptedPrivateKey: string }) => {
			calls.commit.push(args);
			return { ok: true };
		}
	}
}));

const { syncAddressUids } = await import('./uid-sync');

function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

beforeEach(() => {
	calls.list.length = 0;
	calls.update.length = 0;
	calls.reformat.length = 0;
	calls.commit.length = 0;
	behaviour.addresses = {};
	behaviour.updateGate = null;
	behaviour.reformat = () => ({
		ok: true,
		unchanged: false,
		publicKeyArmored: 'pub',
		encryptedPrivateKey: 'enc'
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('syncAddressUids', () => {
	it('routes both requests to the account being synced, not the active one', async () => {
		behaviour.addresses['acct-b'] = ['b@thelemail.com', 'role@thelemail.com'];

		await syncAddressUids('acct-b');

		expect(calls.list).toEqual(['acct-b']);
		expect(calls.reformat).toEqual([
			{ accountId: 'acct-b', emails: ['b@thelemail.com', 'role@thelemail.com'] }
		]);
		expect(calls.update).toEqual([
			{ input: { publicKeyArmored: 'pub', encryptedPrivateKey: 'enc' }, accountId: 'acct-b' }
		]);
		expect(calls.commit).toEqual([{ accountId: 'acct-b', encryptedPrivateKey: 'enc' }]);
	});

	it('skips the fetch when the caller supplies the addresses', async () => {
		await syncAddressUids('acct-b', ['b@thelemail.com']);

		expect(calls.list).toEqual([]);
		expect(calls.reformat).toEqual([{ accountId: 'acct-b', emails: ['b@thelemail.com'] }]);
	});

	it('does not upload when the key already carries the desired uids', async () => {
		behaviour.reformat = () => ({ ok: true, unchanged: true });

		await syncAddressUids('acct-b', ['b@thelemail.com']);

		expect(calls.update).toEqual([]);
		expect(calls.commit).toEqual([]);
	});

	it('stays quiet for a locked vault and warns for anything else', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		behaviour.reformat = () => ({ ok: false, code: 'locked' });
		await syncAddressUids('acct-b', ['b@thelemail.com']);
		expect(warn).not.toHaveBeenCalled();

		behaviour.reformat = () => ({ ok: false, code: 'unknown' });
		await syncAddressUids('acct-b', ['b@thelemail.com']);
		expect(warn).toHaveBeenCalledWith('uid-sync: reformat failed', 'unknown');
	});

	it('swallows an upload failure without committing the reformatted key', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		behaviour.updateGate = {
			promise: Promise.reject(new Error('422')),
			release: () => {}
		};

		await syncAddressUids('acct-b', ['b@thelemail.com']);

		expect(calls.commit).toEqual([]);
		expect(warn).toHaveBeenCalled();
	});

	it('joins a run already in flight for the same address list', async () => {
		const g = gate();
		behaviour.updateGate = g;

		const first = syncAddressUids('acct-b', ['b@thelemail.com']);
		const second = syncAddressUids('acct-b', ['b@thelemail.com']);
		expect(second).toBe(first);

		g.release();
		await first;

		expect(calls.reformat).toHaveLength(1);
	});

	it('queues a run with a different address list instead of dropping it', async () => {
		const g = gate();
		behaviour.updateGate = g;

		const first = syncAddressUids('acct-b', ['b@thelemail.com']);
		const second = syncAddressUids('acct-b', ['b@thelemail.com', 'role@thelemail.com']);
		expect(second).not.toBe(first);

		await vi.waitFor(() => expect(calls.update).toHaveLength(1));
		expect(calls.reformat).toHaveLength(1);

		g.release();
		behaviour.updateGate = null;
		await second;

		expect(calls.reformat).toEqual([
			{ accountId: 'acct-b', emails: ['b@thelemail.com'] },
			{ accountId: 'acct-b', emails: ['b@thelemail.com', 'role@thelemail.com'] }
		]);
	});
});
