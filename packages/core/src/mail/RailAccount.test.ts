import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';

const { goto, auth, accounts } = vi.hoisted(() => {
	const list = [
		{ accountId: 'acct-a', slot: 0, email: 'anna@thelemail.com', addedAt: 1, lastActiveAt: 2 },
		{ accountId: 'acct-b', slot: 1, email: 'boris@thelemail.com', addedAt: 1, lastActiveAt: 1 }
	];
	return {
		goto: vi.fn(async () => {}),
		auth: {
			accountId: 'acct-a',
			fullName: 'Anna',
			email: 'anna@thelemail.com',
			avatarUrl: null,
			activate: vi.fn(),
			fullNameFor: () => null,
			avatarUrlFor: () => null,
			loadSignedInProfiles: vi.fn(async () => {})
		},
		accounts: {
			list,
			byId: (id: string) => list.find((r) => r.accountId === id) ?? null
		}
	};
});

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({
	page: {
		url: new URL('https://mail.test/u/0/mail/sent/msg-123?unread=1'),
		params: { slot: '0', folder: 'sent', id: 'msg-123' }
	}
}));
vi.mock('$core/stores/auth.svelte', () => ({ auth }));
vi.mock('$core/stores/accounts.svelte', () => ({ accounts }));
vi.mock('$core/stores/twofactor.svelte', () => ({
	twofactor: { status: {}, loading: false, load: vi.fn() }
}));
vi.mock('$core/stores/unread.svelte', () => ({ unread: { countsFor: () => null } }));
vi.mock('$core/handoff', () => ({ openCalendar: vi.fn() }));

import RailAccount from './RailAccount.svelte';

describe('RailAccount switching', () => {
	beforeEach(() => {
		Element.prototype.scrollIntoView = vi.fn();
		goto.mockClear();
		auth.activate.mockClear();
	});

	it('lands on the target inbox instead of carrying the open message across', async () => {
		const { container, getByText } = render(RailAccount);
		await fireEvent.click(container.querySelector('.acct-btn')!);
		await fireEvent.click(getByText('Switch account'));
		const row = [...container.querySelectorAll<HTMLButtonElement>('.acct-row')].find((el) =>
			el.textContent?.includes('boris@thelemail.com')
		);
		await fireEvent.click(row!);

		expect(auth.activate).toHaveBeenCalledWith('acct-b');
		expect(goto).toHaveBeenCalledTimes(1);
		expect(goto).toHaveBeenCalledWith('/u/1/mail/inbox');
	});
});
