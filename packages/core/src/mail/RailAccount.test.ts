import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/svelte';
import { holdLeave } from '$core/stores/leaveGuard';

type Probe = 'ok' | 'fail' | 'hang';

const { goto, auth, accounts, unread, facts } = vi.hoisted(() => {
	const list = [
		{ accountId: 'acct-b', slot: 0, email: 'boris@thelemail.com', addedAt: 1, lastActiveAt: 1 },
		{ accountId: 'acct-c', slot: 1, email: 'clara@thelemail.com', addedAt: 1, lastActiveAt: 1 },
		{ accountId: 'acct-a', slot: 2, email: 'anna@thelemail.com', addedAt: 1, lastActiveAt: 2 },
		{ accountId: 'acct-d', slot: 3, email: 'dmitri@thelemail.com', addedAt: 1, lastActiveAt: 1 },
		{ accountId: 'acct-e', slot: 4, email: 'eva@thelemail.com', addedAt: 1, lastActiveAt: 1 },
		{ accountId: 'acct-f', slot: 5, email: 'fay@thelemail.com', addedAt: 1, lastActiveAt: 1 }
	];
	const names: Record<string, string> = {
		'acct-a': 'Anna',
		'acct-b': 'Boris',
		'acct-c': 'Clara',
		'acct-d': 'Dmitri',
		'acct-e': 'Eva',
		'acct-f': 'Fay'
	};
	const facts = {
		locked: new Set<string>(),
		lost: new Set<string>(),
		counts: new Map<string, { inbox: number }>(),
		probes: new Map<string, Probe>()
	};
	return {
		facts,
		goto: vi.fn(async (_: string) => {}),
		auth: {
			accountId: 'acct-a',
			fullName: 'Anna',
			email: 'anna@thelemail.com',
			avatarUrl: null,
			activate: vi.fn(),
			fullNameFor: (id: string) => names[id] ?? null,
			avatarUrlFor: () => null,
			loadSignedInProfiles: vi.fn(async () => {}),
			syncFromKeystoreStatus: vi.fn(),
			vaultUnlockedFor: (id: string) => !facts.locked.has(id),
			hasPersistentFor: () => false,
			sessionLost: (id: string) => facts.lost.has(id),
			ensureFreshToken: vi.fn(async () => {})
		},
		accounts: {
			list,
			byId: (id: string) => list.find((r) => r.accountId === id) ?? null
		},
		unread: {
			countsFor: (id: string) => facts.counts.get(id) ?? null,
			refresh: vi.fn((id: string): Promise<boolean> => {
				const p = facts.probes.get(id) ?? 'ok';
				if (p === 'hang') return new Promise(() => {});
				if (p === 'fail') return Promise.resolve(false);
				if (!facts.counts.has(id)) facts.counts.set(id, { inbox: 0 });
				return Promise.resolve(true);
			})
		}
	};
});

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({
	page: {
		url: new URL('https://mail.test/u/2/mail/sent/msg-123?unread=1'),
		params: { slot: '2', folder: 'sent', id: 'msg-123' }
	}
}));
vi.mock('$core/stores/auth.svelte', () => ({ auth }));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts }));
vi.mock('$core/stores/unread.svelte', () => ({ unread }));
vi.mock('$core/keystore/keystore-client', () => ({
	keystore: { status: vi.fn(async () => ({ accounts: [] })) }
}));
vi.mock('$core/stores/twofactor.svelte', () => ({
	twofactor: { status: {}, phase: 'ready', load: vi.fn(), ensure: vi.fn() }
}));
vi.mock('$core/handoff', () => ({ openCalendar: vi.fn() }));

import RailAccount from './RailAccount.svelte';

function rowsOf(container: HTMLElement): HTMLButtonElement[] {
	return [...container.querySelectorAll<HTMLButtonElement>('.acct-row')];
}

function rowFor(container: HTMLElement, email: string): HTMLButtonElement {
	const row = rowsOf(container).find((el) => el.textContent?.includes(email));
	if (!row) throw new Error(`no row for ${email}`);
	return row;
}

async function openMenu(container: HTMLElement) {
	await fireEvent.click(container.querySelector('.acct-btn')!);
	await waitFor(() => expect(rowFor(container, 'fay@').dataset.state).toBe('syncing'));
	await waitFor(() => expect(rowFor(container, 'boris@').dataset.state).toBe('ready'));
}

describe('RailAccount', () => {
	let releaseLeave: (() => void) | null = null;

	beforeEach(() => {
		goto.mockClear();
		auth.activate.mockClear();
		unread.refresh.mockClear();
		facts.locked = new Set(['acct-c']);
		facts.lost = new Set(['acct-d']);
		facts.counts = new Map([
			['acct-b', { inbox: 3 }],
			['acct-e', { inbox: 12 }]
		]);
		facts.probes = new Map<string, Probe>([
			['acct-e', 'fail'],
			['acct-f', 'hang']
		]);
	});

	afterEach(() => {
		cleanup();
		releaseLeave?.();
		releaseLeave = null;
	});

	it('lists the current account first, then the others in slot order, one row per account', async () => {
		const { container } = render(RailAccount);
		await openMenu(container);

		const rows = rowsOf(container);
		expect(rows.map((r) => r.querySelector('.ar-nm')?.textContent)).toEqual([
			'Anna',
			'Boris',
			'Clara',
			'Dmitri',
			'Eva',
			'Fay'
		]);
		expect(rows[0].getAttribute('aria-current')).toBe('true');
		expect(rows[0].textContent).toContain('Current');
		expect(rows.slice(1).every((r) => !r.hasAttribute('aria-current'))).toBe(true);
		expect(rows.every((r) => r.querySelector('.ar-em')?.textContent?.includes('@'))).toBe(true);
	});

	it('shows each readiness state with its action and hides counts that have not loaded', async () => {
		const { container } = render(RailAccount);
		await openMenu(container);

		const boris = rowFor(container, 'boris@');
		expect(boris.textContent).toContain('3 unread');

		const clara = rowFor(container, 'clara@');
		expect(clara.dataset.state).toBe('locked');
		expect(clara.querySelector('.ar-act')?.textContent).toBe('Unlock');
		expect(clara.getAttribute('aria-label')).toBe('Unlock: Clara, clara@thelemail.com, Locked');

		const dmitri = rowFor(container, 'dmitri@');
		expect(dmitri.dataset.state).toBe('expired');
		expect(dmitri.querySelector('.ar-act')?.textContent).toBe('Sign in');
		expect(dmitri.textContent).toContain('Session expired');

		const eva = rowFor(container, 'eva@');
		await waitFor(() => expect(eva.dataset.state).toBe('unavailable'));
		expect(eva.querySelector('.ar-act')?.textContent).toBe('Try again');
		expect(eva.textContent).not.toContain('12');

		const fay = rowFor(container, 'fay@');
		expect(fay.textContent).toContain('Syncing');
		expect(fay.querySelector('.ar-unread')).toBeNull();
		expect(fay.querySelector('.ar-act')).toBeNull();

		expect(unread.refresh).not.toHaveBeenCalledWith('acct-c');
		expect(unread.refresh).not.toHaveBeenCalledWith('acct-d');
	});

	it('does not re-check accounts that were checked within the last minute', async () => {
		const { container } = render(RailAccount);
		await openMenu(container);
		const trigger = container.querySelector<HTMLButtonElement>('.acct-btn')!;
		await fireEvent.click(trigger);
		unread.refresh.mockClear();

		await openMenu(container);
		expect(unread.refresh).not.toHaveBeenCalledWith('acct-b');
		expect(unread.refresh).toHaveBeenCalledWith('acct-e');
	});

	it('switches a ready account straight to its inbox without confirmation', async () => {
		const { container } = render(RailAccount);
		await openMenu(container);
		await fireEvent.click(rowFor(container, 'boris@'));

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/u/0/mail/inbox'));
		expect(auth.activate).toHaveBeenCalledWith('acct-b');
		expect(goto).toHaveBeenCalledTimes(1);
		expect(container.querySelector('[role="menu"]')).toBeNull();
	});

	it('sends a locked account to unlock instead of opening its mailbox', async () => {
		const { container } = render(RailAccount);
		await openMenu(container);
		await fireEvent.click(rowFor(container, 'clara@'));

		await waitFor(() =>
			expect(goto).toHaveBeenCalledWith(
				`/login?slot=1&redirect=${encodeURIComponent('/u/1/mail/inbox')}`
			)
		);
		expect(auth.activate).not.toHaveBeenCalled();
	});

	it('sends an expired session to sign in again', async () => {
		const { container } = render(RailAccount);
		await openMenu(container);
		await fireEvent.click(rowFor(container, 'dmitri@'));

		await waitFor(() =>
			expect(goto).toHaveBeenCalledWith(
				`/login?slot=3&redirect=${encodeURIComponent('/u/3/mail/inbox')}`
			)
		);
		expect(auth.activate).not.toHaveBeenCalled();
	});

	it('retries an unavailable account in place and recovers once it loads', async () => {
		const { container } = render(RailAccount);
		await openMenu(container);
		const eva = rowFor(container, 'eva@');
		await waitFor(() => expect(eva.dataset.state).toBe('unavailable'));

		facts.probes.set('acct-e', 'ok');
		unread.refresh.mockClear();
		await fireEvent.click(eva);

		await waitFor(() => expect(rowFor(container, 'eva@').dataset.state).toBe('ready'));
		expect(unread.refresh).toHaveBeenCalledWith('acct-e');
		expect(goto).not.toHaveBeenCalled();
		expect(container.querySelector('[role="menu"]')).not.toBeNull();
	});

	it('keeps the current account when a pending draft cannot be preserved', async () => {
		const focus = vi.fn();
		releaseLeave = holdLeave({ pending: () => true, settle: async () => false, focus });
		const { container } = render(RailAccount);
		await openMenu(container);
		await fireEvent.click(rowFor(container, 'boris@'));

		await waitFor(() => expect(focus).toHaveBeenCalled());
		expect(auth.activate).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
	});

	it('switches after a pending draft saves', async () => {
		let saved = false;
		releaseLeave = holdLeave({
			pending: () => !saved,
			settle: async () => {
				saved = true;
				return true;
			}
		});
		const { container } = render(RailAccount);
		await openMenu(container);
		await fireEvent.click(rowFor(container, 'boris@'));

		await waitFor(() => expect(goto).toHaveBeenCalledWith('/u/0/mail/inbox'));
		expect(saved).toBe(true);
	});

	it('supports opening, arrow navigation, selection and Escape from the keyboard', async () => {
		const { container } = render(RailAccount);
		const trigger = container.querySelector<HTMLButtonElement>('.acct-btn')!;
		expect(trigger.getAttribute('aria-haspopup')).toBe('menu');

		trigger.focus();
		await fireEvent.keyDown(trigger, { key: 'Enter' });
		const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		expect(trigger.getAttribute('aria-controls')).toBe(menu.id);
		await waitFor(() => expect(document.activeElement).toBe(rowsOf(container)[0]));

		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(rowFor(container, 'boris@'));

		await fireEvent.keyDown(menu, { key: 'ArrowUp' });
		await fireEvent.keyDown(menu, { key: 'ArrowUp' });
		const items = [...menu.querySelectorAll('[role="menuitem"]')];
		expect(document.activeElement).toBe(items[items.length - 1]);

		await fireEvent.keyDown(menu, { key: 'Home' });
		expect(document.activeElement).toBe(rowsOf(container)[0]);

		await fireEvent.keyDown(menu, { key: 'Escape' });
		expect(container.querySelector('[role="menu"]')).toBeNull();
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(trigger);

		await fireEvent.keyDown(trigger, { key: 'ArrowUp' });
		await waitFor(() => {
			const all = [...container.querySelectorAll('[role="menuitem"]')];
			expect(document.activeElement).toBe(all[all.length - 1]);
		});
		await fireEvent.keyDown(container.querySelector('[role="menu"]')!, { key: 'Home' });
		await fireEvent.keyDown(container.querySelector('[role="menu"]')!, { key: 'ArrowDown' });
		await fireEvent.click(document.activeElement as HTMLElement);
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/u/0/mail/inbox'));
	});

	it('focuses the menu itself when opened with the pointer, then arrows into the list', async () => {
		const { container } = render(RailAccount);
		await openMenu(container);
		const menu = container.querySelector<HTMLElement>('[role="menu"]')!;
		expect(document.activeElement).toBe(menu);

		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(rowsOf(container)[0]);
	});

	it('closes without switching when the current account is chosen', async () => {
		const { container } = render(RailAccount);
		await openMenu(container);
		await fireEvent.click(rowsOf(container)[0]);

		expect(container.querySelector('[role="menu"]')).toBeNull();
		expect(auth.activate).not.toHaveBeenCalled();
		expect(goto).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(container.querySelector('.acct-btn'));
	});

	it('keeps Add account and Manage accounts apart from the account list', async () => {
		const { container } = render(RailAccount);
		await openMenu(container);
		const list = container.querySelector('.acct-list')!;
		expect(list.textContent).not.toContain('Add account');
		expect(list.textContent).not.toContain('Manage accounts');

		await fireEvent.click(within(container).getByText('Add account'));
		await waitFor(() => expect(goto).toHaveBeenCalledWith('/login?addAccount=1'));
	});
});
