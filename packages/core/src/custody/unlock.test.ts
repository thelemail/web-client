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
		bySlot: (slot: number) => slots.list.find((r) => r.slot === slot) ?? null,
		byId: (id: string) => slots.list.find((r) => r.accountId === id) ?? null
	}
}));
const sessions = vi.hoisted(() => ({ ids: new Map<string, string>() }));
vi.mock('$core/stores/session.svelte', () => ({ auth: { sessionIdFor: (id: string) => sessions.ids.get(id) ?? null } }));

import { confirmAtAuth, mailOnlyAccountId, unlockAtAuth } from './unlock';

const MAIL = 'acc-mail';
const LEGACY = 'acc-legacy';

beforeEach(() => {
	status.mockReset();
	startHandoff.mockReset();
	sessions.ids.clear();
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
		await vi.waitFor(() =>
			expect(startHandoff).toHaveBeenCalledWith({
				expectedAccountId: MAIL,
				route: '/u/0/mail/sent',
				remember: true,
				existingSessionId: null,
				hint: 'Calloway@Thelemail.test'
			})
		);

		startHandoff.mockClear();
		void unlockAtAuth(LEGACY, 'https://evil.test/');
		await vi.waitFor(() =>
			expect(startHandoff).toHaveBeenCalledWith({ expectedAccountId: LEGACY, route: '/', remember: false, existingSessionId: null, hint: 'nora@thelemail.test' })
		);
	});

	it('names the mail session the handoff replaces', async () => {
		startHandoff.mockResolvedValue(undefined);
		sessions.ids.set(MAIL, '0b8f9a52-3c1d-4e6f-8a7b-9c0d1e2f3a4b');
		void unlockAtAuth(MAIL, '/u/0/mail/inbox');
		await vi.waitFor(() =>
			expect(startHandoff).toHaveBeenCalledWith(expect.objectContaining({ existingSessionId: '0b8f9a52-3c1d-4e6f-8a7b-9c0d1e2f3a4b' }))
		);
	});

	it('asks the account origin for a fresh sign-in when an action needs one', async () => {
		startHandoff.mockResolvedValue(undefined);
		window.history.replaceState(null, '', '/u/0/settings/billing?plan=pro');
		void confirmAtAuth(MAIL);
		await vi.waitFor(() =>
			expect(startHandoff).toHaveBeenCalledWith({
				expectedAccountId: MAIL,
				route: '/u/0/settings/billing?plan=pro',
				remember: true,
				existingSessionId: null,
				hint: 'Calloway@Thelemail.test',
				freshAuth: true
			})
		);
	});

	it('gives the action up when the account origin cannot be opened', async () => {
		startHandoff.mockRejectedValue(new Error('offline'));
		expect(await confirmAtAuth(MAIL)).toBe(false);
	});

	it('reports a handoff that could not start', async () => {
		startHandoff.mockRejectedValue(new Error('offline'));
		await expect(unlockAtAuth(MAIL, null)).rejects.toThrow('offline');
	});
});
