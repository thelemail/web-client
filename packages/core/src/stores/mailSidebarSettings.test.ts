import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAccountSettings = vi.fn();
const putAccountSettingsSection = vi.fn();

vi.mock('$core/api/accountSettings', () => ({
	getAccountSettings: (...a: unknown[]) => getAccountSettings(...a),
	putAccountSettingsSection: (...a: unknown[]) => putAccountSettingsSection(...a)
}));

vi.mock('./auth.svelte', () => ({
	auth: { canEnterApp: true, accountId: 'acc-1' }
}));

import { accountSettings, parseMailSidebar } from './accountSettings.svelte';

let account = 0;

async function freshAccount(sidebar?: unknown) {
	account += 1;
	getAccountSettings.mockResolvedValue({ sections: sidebar === undefined ? {} : { mail_sidebar: sidebar } });
	accountSettings.setAccount(`acc-${account}`);
	await accountSettings.hydrate();
}

function sidebarPuts() {
	return putAccountSettingsSection.mock.calls.filter(([section]) => section === 'mail_sidebar');
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.useFakeTimers();
	putAccountSettingsSection.mockResolvedValue({});
});

afterEach(() => {
	vi.useRealTimers();
});

describe('mail sidebar settings', () => {
	it('keeps only well-formed values', () => {
		expect(
			parseMailSidebar({
				expanded: ['a', 7, 'a', 'b', 'x'.repeat(65)],
				collapsed: ['labels', 'inbox', 'favorites'],
				showMore: 'yes'
			})
		).toEqual({ expanded: ['a', 'b'], collapsed: ['favorites', 'labels'], showMore: false });
		expect(parseMailSidebar(null)).toEqual({ expanded: [], collapsed: [], showMore: false });
	});

	it('hydrates the section and defaults when it is missing', async () => {
		await freshAccount({ expanded: ['f1'], collapsed: ['folders'], showMore: true });
		expect(accountSettings.mailSidebar).toEqual({
			expanded: ['f1'],
			collapsed: ['folders'],
			showMore: true
		});

		await freshAccount();
		expect(accountSettings.mailSidebar).toEqual({ expanded: [], collapsed: [], showMore: false });
	});

	it('applies changes at once and writes one debounced section', async () => {
		await freshAccount();

		accountSettings.persistMailSidebar({ expanded: ['f1'], collapsed: [], showMore: false });
		accountSettings.persistMailSidebar({ expanded: ['f1', 'f2'], collapsed: ['labels'], showMore: false });

		expect(accountSettings.mailSidebar.expanded).toEqual(['f1', 'f2']);
		expect(sidebarPuts()).toHaveLength(0);

		await vi.advanceTimersByTimeAsync(400);

		expect(sidebarPuts()).toEqual([
			['mail_sidebar', { expanded: ['f1', 'f2'], collapsed: ['labels'], showMore: false }]
		]);
	});

	it('drops a pending write when the account changes', async () => {
		await freshAccount();
		accountSettings.persistMailSidebar({ expanded: ['f1'], collapsed: [], showMore: false });

		await freshAccount();
		await vi.advanceTimersByTimeAsync(1000);

		expect(sidebarPuts()).toHaveLength(0);
	});

	it('does not let a refresh undo a change that has not been written yet', async () => {
		await freshAccount({ expanded: [], collapsed: [], showMore: false });
		accountSettings.persistMailSidebar({ expanded: ['f1'], collapsed: [], showMore: false });

		await accountSettings.refresh();

		expect(accountSettings.mailSidebar.expanded).toEqual(['f1']);
	});
});
