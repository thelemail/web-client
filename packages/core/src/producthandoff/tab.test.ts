import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authTabPendingFor, awaitAuthTab, handBack, inAuthTab, leaveAuthTab, markAuthTab, openAuthTab } from './tab';

const ACCOUNT = '5d2a8f3e-1c4b-4e7a-9f60-3b8d2c1e0a47';
const open = vi.fn();
let stops: (() => void)[] = [];

beforeEach(() => {
	open.mockReset();
	vi.stubGlobal('open', open);
	sessionStorage.clear();
});

afterEach(() => {
	for (const stop of stops) stop();
	stops = [];
	vi.unstubAllGlobals();
});

describe('the sign-in tab', () => {
	it('opens the start page of this origin with the account and route', () => {
		open.mockReturnValue({});
		expect(openAuthTab(ACCOUNT, '/u/1/mail/inbox')).toBe(true);
		const [url, target] = open.mock.calls[0] as [string, string];
		expect(target).toBe('_blank');
		expect(url.startsWith('/auth/start#')).toBe(true);
		const fragment = new URLSearchParams(url.split('#')[1]);
		expect(Object.fromEntries(fragment)).toEqual({ account: ACCOUNT, route: '/u/1/mail/inbox', tab: '1' });
		expect(authTabPendingFor(ACCOUNT)).toBe(true);
	});

	it('reports a blocked tab', () => {
		open.mockReturnValue(null);
		expect(openAuthTab(ACCOUNT, '/')).toBe(false);
		expect(authTabPendingFor(ACCOUNT)).toBe(false);
	});

	it('marks and clears only this tab', () => {
		expect(inAuthTab()).toBe(false);
		markAuthTab();
		expect(inAuthTab()).toBe(true);
		leaveAuthTab();
		expect(inAuthTab()).toBe(false);
	});

	it('hands the finished account back to the waiting page', async () => {
		const done = vi.fn();
		stops.push(awaitAuthTab(ACCOUNT, done));
		expect(await handBack({ accountId: ACCOUNT, path: '/u/1/mail/inbox' })).toBe(true);
		expect(done).toHaveBeenCalledWith({ accountId: ACCOUNT, path: '/u/1/mail/inbox' });
	});

	it('keeps going in its own tab when nothing waits for that account', async () => {
		const other = vi.fn();
		stops.push(awaitAuthTab('7c1e2d3f-4a5b-4c6d-8e7f-90a1b2c3d4e5', other));
		vi.useFakeTimers();
		const handed = handBack({ accountId: ACCOUNT, path: '/u/1/mail/inbox' });
		await vi.advanceTimersByTimeAsync(1500);
		vi.useRealTimers();
		expect(await handed).toBe(false);
		expect(other).not.toHaveBeenCalled();
	});

	it('ignores a path outside an account mailbox', async () => {
		const done = vi.fn();
		stops.push(awaitAuthTab(ACCOUNT, done));
		vi.useFakeTimers();
		const handed = handBack({ accountId: ACCOUNT, path: 'https://elsewhere.test/u/1' });
		await vi.advanceTimersByTimeAsync(1500);
		vi.useRealTimers();
		expect(await handed).toBe(false);
		expect(done).not.toHaveBeenCalled();
	});
});
