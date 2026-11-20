import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { m } from '$paraglide/messages.js';

const flow = vi.hoisted(() => ({
	complete: vi.fn(),
	handBack: vi.fn(),
	inTab: vi.fn(() => true),
	leave: vi.fn(),
	goto: vi.fn(async () => undefined),
	activate: vi.fn()
}));

vi.mock('$app/navigation', () => ({ goto: flow.goto }));
vi.mock('./complete', () => ({ completeHandoff: flow.complete, takeCallbackFragment: () => 'code=c&state=s' }));
vi.mock('./tab', () => ({ handBack: flow.handBack, inAuthTab: flow.inTab, leaveAuthTab: flow.leave }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { activate: flow.activate, emailFor: () => null } }));
vi.mock('$core/stores/accounts.svelte', () => ({
	accounts: { list: [], byId: (id: string) => (id === 'acc-hal' ? { accountId: 'acc-hal', slot: 1, email: 'hal@thelemail.com' } : undefined) }
}));
vi.mock('$core/fork', () => ({ localForkPath: (route: string, slot: number) => `/u/${slot}${route}` }));

const HandoffCallback = (await import('./HandoffCallback.svelte')).default;

function button(label: string) {
	return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
}

let close: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	for (const fn of Object.values(flow)) fn.mockClear();
	flow.inTab.mockReturnValue(true);
	flow.complete.mockResolvedValue({ accountId: 'acc-hal', slot: 1, route: '/mail/inbox' });
	close = vi.fn();
	vi.stubGlobal('close', close);
	Object.defineProperty(window, 'closed', { configurable: true, value: false });
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('sign-in tab after the handoff', () => {
	it('names the account and counts down before closing itself', async () => {
		flow.handBack.mockResolvedValue(true);
		render(HandoffCallback);

		await vi.waitFor(() => expect(document.body.textContent).toContain('hal@thelemail.com is unlocked.'));
		expect(document.body.textContent).toContain('Back to your mail in 3 s.');
		expect(document.body.textContent).toContain(m.handoff_tab_closes());
		expect(flow.handBack).toHaveBeenCalledWith({ accountId: 'acc-hal', path: '/u/1/mail/inbox' });

		await vi.advanceTimersByTimeAsync(1000);
		expect(document.body.textContent).toContain('in 2 s.');
		expect(close).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(2000);
		expect(close).toHaveBeenCalledTimes(1);
		expect(flow.goto).not.toHaveBeenCalled();
	});

	it('closes at once on Go now', async () => {
		flow.handBack.mockResolvedValue(true);
		render(HandoffCallback);
		await vi.waitFor(() => expect(button(m.handoff_tab_go_now())).toBeDefined());

		await fireEvent.click(button(m.handoff_tab_go_now())!);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it('stops the countdown when asked to stay and offers to close later', async () => {
		flow.handBack.mockResolvedValue(true);
		render(HandoffCallback);
		await vi.waitFor(() => expect(button(m.handoff_tab_stay())).toBeDefined());

		await fireEvent.click(button(m.handoff_tab_stay())!);
		await vi.advanceTimersByTimeAsync(5000);

		expect(close).not.toHaveBeenCalled();
		expect(document.body.textContent).toContain('your mail tab has hal@thelemail.com open');
		expect(button(m.handoff_tab_close())).toBeDefined();
	});

	it('says what to do when the browser keeps the tab open', async () => {
		flow.handBack.mockResolvedValue(true);
		render(HandoffCallback);
		await vi.waitFor(() => expect(button(m.handoff_tab_go_now())).toBeDefined());

		await fireEvent.click(button(m.handoff_tab_go_now())!);
		await vi.advanceTimersByTimeAsync(400);

		expect(document.body.textContent).toContain('You can close this tab.');
		expect(button(m.handoff_tab_close())).toBeDefined();
	});

	it('opens the mailbox here when no mail tab took the account', async () => {
		flow.handBack.mockResolvedValue(false);
		render(HandoffCallback);

		await vi.waitFor(() => expect(flow.goto).toHaveBeenCalledWith('/u/1/mail/inbox', { replace: true }));
		expect(flow.activate).toHaveBeenCalledWith('acc-hal');
		expect(close).not.toHaveBeenCalled();
	});

	it('shows the failure with a way back', async () => {
		flow.complete.mockRejectedValue(new Error('expired'));
		render(HandoffCallback);

		await vi.waitFor(() => expect(document.body.textContent).toContain(m.handoff_failed()));
		expect(flow.leave).toHaveBeenCalled();
		const links = [...document.querySelectorAll('a[href="/"]')].map((a) => a.textContent?.trim());
		expect(links).toContain(m.handoff_restart());
	});
});
