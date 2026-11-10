import { beforeEach, describe, expect, it, vi } from 'vitest';

const status = vi.fn();
const startHandoff = vi.fn();
const slots = vi.hoisted(() => ({ list: [] as { accountId: string; slot: number; email: string }[] }));

vi.mock('$core/keystore/keystore-client', () => ({ keystore: { status: (...a: unknown[]) => status(...a) } }));
vi.mock('$core/producthandoff/begin', () => ({
	startHandoff: (...a: unknown[]) => startHandoff(...a),
	safeRoute: (v: string | null | undefined) => (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/auth/') ? '/' : v)
}));
vi.mock('$core/stores/accounts.svelte', () => ({
	accounts: {
		load: vi.fn(async () => undefined),
		get list() {
			return slots.list;
		},
		bySlot: (slot: number) => slots.list.find((r) => r.slot === slot) ?? null
	}
}));

import { mailOnlyAccountId, unlockAtAuth } from './unlock';

const MAIL = 'acc-mail';
const LEGACY = 'acc-legacy';

beforeEach(() => {
	status.mockReset();
	startHandoff.mockReset();
	slots.list = [
		{ accountId: MAIL, slot: 0, email: 'Calloway@Thelemail.test' },
		{ accountId: LEGACY, slot: 1, email: 'nora@thelemail.test' }
	];
	status.mockResolvedValue({
		accounts: [
			{ accountId: MAIL, email: 'calloway@thelemail.test', unlocked: false, hasPersistent: true, authScheme: 'opaque_v1', mailOnly: true },
			{ accountId: LEGACY, email: 'nora@thelemail.test', unlocked: false, hasPersistent: false, authScheme: 'opaque_v1' }
		]
	});
});

describe('unlocking a mail-only account', () => {
	it('finds a mail-only account by slot or by the address typed', async () => {
		expect(await mailOnlyAccountId({ slot: 0 })).toBe(MAIL);
		expect(await mailOnlyAccountId({ identifier: 'calloway@thelemail.test' })).toBe(MAIL);
	});

	it('leaves legacy and unknown accounts to the password form', async () => {
		expect(await mailOnlyAccountId({ slot: 1 })).toBeNull();
		expect(await mailOnlyAccountId({ identifier: 'nora@thelemail.test' })).toBeNull();
		expect(await mailOnlyAccountId({ slot: 7 })).toBeNull();
		expect(await mailOnlyAccountId({ identifier: 'new@thelemail.test' })).toBeNull();
		expect(await mailOnlyAccountId({ slot: Number.NaN })).toBeNull();
		expect(await mailOnlyAccountId({})).toBeNull();
	});

	it('starts a handoff for that account, keeping its remember choice and route', async () => {
		startHandoff.mockResolvedValue(undefined);
		void unlockAtAuth(MAIL, '/u/0/mail/sent');
		await vi.waitFor(() => expect(startHandoff).toHaveBeenCalledWith({ expectedAccountId: MAIL, route: '/u/0/mail/sent', remember: true }));

		startHandoff.mockClear();
		void unlockAtAuth(LEGACY, 'https://evil.test/');
		await vi.waitFor(() => expect(startHandoff).toHaveBeenCalledWith({ expectedAccountId: LEGACY, route: '/', remember: false }));
	});

	it('reports a handoff that could not start', async () => {
		startHandoff.mockRejectedValue(new Error('offline'));
		await expect(unlockAtAuth(MAIL, null)).rejects.toThrow('offline');
	});
});
