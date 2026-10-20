import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet, flushSync } from 'svelte';

const goto = vi.hoisted(() => vi.fn());
const lost = vi.hoisted(() => ({ value: false }));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({
	page: { params: { slot: '2' }, url: new URL('http://localhost/u/2/mail/inbox?q=x') }
}));
vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/lifecycle/lifecycle.svelte', () => ({ lifecycle: { setAccount: vi.fn() } }));
vi.mock('$core/realtime/realtime.svelte', () => ({ realtime: { start: vi.fn() } }));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts: { list: [] } }));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribe: () => () => {} } }));
vi.mock('$core/stores/auth.svelte', () => ({
	auth: {
		sessionLost: () => lost.value,
		getAccessToken: () => null,
		ensureFreshToken: vi.fn(),
		tryRefresh: vi.fn()
	}
}));
vi.mock('$core/mail/MirrorScopePrompt.svelte', () => ({ default: () => {} }));
vi.mock('$core/auth/ReauthDialog.svelte', () => ({ default: () => {} }));
vi.mock('$core/stores/mailbox.svelte', () => ({ mailbox: { refreshLoaded: vi.fn() } }));
vi.mock('$core/stores/search.svelte', () => ({ mailSearch: { start: vi.fn() } }));

const { default: SlotLayout } = await import('./+layout.svelte');

const children = createRawSnippet(() => ({ render: () => '<p>mail</p>' }));

afterEach(() => {
	cleanup();
	goto.mockReset();
	lost.value = false;
});

describe('account slot layout', () => {
	it('sends a revoked session to sign-in for its slot', () => {
		lost.value = true;
		render(SlotLayout, { props: { data: { accountId: 'acc-1', slot: 2 }, children } });
		flushSync();
		expect(goto).toHaveBeenCalledWith(`/login?slot=2&redirect=${encodeURIComponent('/u/2/mail/inbox?q=x')}`);
	});

	it('stays put while the session is live', () => {
		render(SlotLayout, { props: { data: { accountId: 'acc-1', slot: 2 }, children } });
		flushSync();
		expect(goto).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('mail');
	});
});
