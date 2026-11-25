import { beforeEach, describe, expect, it, vi } from 'vitest';
import { utf8 } from '$core/keystore/productkeys/canonical';
import { sha256 } from '$core/keystore/productkeys/encoding';
import { b64url } from '$core/keystore/handoff/wire';

const local = vi.hoisted(() => ({ list: [] as { accountId: string; slot: number }[] }));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: local }));

const created = vi.hoisted(() => ({ requests: [] as Record<string, unknown>[], tamper: null as null | ((d: Record<string, unknown>) => void) }));

vi.mock('$core/products', () => ({ productTarget: (audience: string) => (audience === 'auth' ? { audience, origin: 'https://auth.thelemail.test' } : null) }));
vi.mock('$core/keystore/handoff/store', () => ({ putRequest: vi.fn(async () => undefined), purgeExpiredRequests: vi.fn(async () => []) }));
vi.mock('./api', () => ({
	bootstrap: vi.fn(async () => ({ csrfToken: 'csrf' })),
	createRequest: vi.fn(async (req: Record<string, unknown>) => {
		created.requests.push(req);
		const descriptor: Record<string, unknown> = {
			callback: `${window.location.origin}/auth/callback`,
			clientId: 'web-mail',
			codeChallenge: req.codeChallenge,
			codeChallengeMethod: 'S256',
			createdAt: 1_800_000_000,
			existingSessionId: req.existingSessionId,
			expectedAccountId: req.expectedAccountId,
			expiresAt: 1_800_000_600,
			origin: window.location.origin,
			product: 'app',
			receiverPublicKey: req.receiverPublicKey,
			requestId: '6f0f8a59-2c1d-4a1e-9b3b-0b6a3c5d7e11',
			state: req.state,
			version: 1
		};
		created.tamper?.(descriptor);
		const raw = JSON.stringify(descriptor);
		return { requestId: descriptor.requestId, descriptor: raw, descriptorDigest: b64url(await sha256(utf8(raw))), expiresAt: '2027-01-15T08:10:00Z' };
	})
}));

const { startHandoff } = await import('./begin');

const ACCOUNT = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const SESSION = '0b8f9a52-3c1d-4e6f-8a7b-9c0d1e2f3a4b';
const assign = vi.fn();

beforeEach(() => {
	created.requests = [];
	created.tamper = null;
	local.list = [];
	assign.mockReset();
	Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, origin: window.location.origin, assign } });
});

describe('starting a handoff', () => {
	it('names the session it replaces and carries the address to fill in', async () => {
		await startHandoff({ expectedAccountId: ACCOUNT, route: '/u/0/mail/inbox', remember: false, existingSessionId: SESSION, hint: 'calloway@thelemail.test' });
		expect(created.requests[0]).toMatchObject({ expectedAccountId: ACCOUNT, existingSessionId: SESSION });
		const target = new URL(assign.mock.calls[0][0] as string);
		expect(target.origin + target.pathname).toBe('https://auth.thelemail.test/authorize');
		const fragment = new URLSearchParams(target.hash.slice(1));
		expect(fragment.get('hint')).toBe('calloway@thelemail.test');
		expect(fragment.get('request')).toBe('6f0f8a59-2c1d-4a1e-9b3b-0b6a3c5d7e11');
	});

	it('sends no session and no hint unless asked', async () => {
		await startHandoff({ expectedAccountId: null, route: '/', remember: false });
		expect(created.requests[0]).toMatchObject({ expectedAccountId: null, existingSessionId: null });
		expect(new URLSearchParams(new URL(assign.mock.calls[0][0] as string).hash.slice(1)).has('hint')).toBe(false);
	});

	it('tells the account origin which index each local account has and what the person came to do', async () => {
		local.list = [
			{ accountId: ACCOUNT, slot: 0 },
			{ accountId: SESSION, slot: 3 }
		];
		await startHandoff({ expectedAccountId: null, route: '/', remember: false, intent: 'register' });
		const fragment = new URLSearchParams(new URL(assign.mock.calls[0][0] as string).hash.slice(1));
		expect(fragment.get('slots')).toBe(`${ACCOUNT}.0,${SESSION}.3`);
		expect(fragment.get('intent')).toBe('register');
	});

	it('carries only the plan, billing period and source into a registration', async () => {
		await startHandoff({ expectedAccountId: null, route: '/', remember: false, intent: 'register', registerQuery: '?plan=family&billing=monthly&src=pricing&redirect=https://evil.test' });
		const fragment = new URLSearchParams(new URL(assign.mock.calls[0][0] as string).hash.slice(1));
		expect(fragment.get('register')).toBe('plan=family&billing=monthly&src=pricing');
	});

	it('refuses a descriptor that names another existing session', async () => {
		created.tamper = (d) => {
			d.existingSessionId = '7c1e2d3f-4a5b-4c6d-8e7f-90a1b2c3d4e5';
		};
		await expect(startHandoff({ expectedAccountId: ACCOUNT, route: '/', remember: false, existingSessionId: SESSION })).rejects.toMatchObject({ code: 'descriptor' });
		expect(assign).not.toHaveBeenCalled();
	});
});
