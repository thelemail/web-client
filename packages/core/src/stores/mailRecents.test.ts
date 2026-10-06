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

import { accountSettings, parseMailRecents, pushRecents } from './accountSettings.svelte';

let account = 0;

async function freshAccount(recents?: unknown) {
	account += 1;
	getAccountSettings.mockResolvedValue({
		sections: recents === undefined ? {} : { mail_recents: recents }
	});
	accountSettings.setAccount(`recents-${account}`);
	await accountSettings.hydrate();
}

function recentsPuts() {
	return putAccountSettingsSection.mock.calls.filter(([section]) => section === 'mail_recents');
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.useFakeTimers();
	putAccountSettingsSection.mockResolvedValue({});
});

afterEach(() => {
	vi.useRealTimers();
});

describe('mail recents', () => {
	it('keeps only well-formed ids, deduped and capped', () => {
		expect(
			parseMailRecents({
				move: ['a', 'a', 3, '', 'x'.repeat(65), 'b', 'c', 'd', 'e', 'f', 'g'],
				labels: 'nope'
			})
		).toEqual({ move: ['a', 'b', 'c', 'd', 'e', 'f'], labels: [] });
		expect(parseMailRecents(null)).toEqual({ move: [], labels: [] });
	});

	it('puts the most recently used first', () => {
		expect(pushRecents(['a', 'b', 'c'], ['c'])).toEqual(['c', 'a', 'b']);
		expect(pushRecents(['a', 'b'], ['x', 'y'])).toEqual(['y', 'x', 'a', 'b']);
		expect(pushRecents(['1', '2', '3', '4', '5', '6'], ['7'])).toEqual(['7', '1', '2', '3', '4', '5']);
	});

	it('hydrates and saves one debounced write', async () => {
		await freshAccount({ move: ['archive'], labels: ['l1'] });
		expect(accountSettings.mailRecents).toEqual({ move: ['archive'], labels: ['l1'] });

		accountSettings.recordRecents('move', ['f1']);
		accountSettings.recordRecents('labels', ['l2', 'l3']);
		expect(accountSettings.mailRecents).toEqual({ move: ['f1', 'archive'], labels: ['l3', 'l2', 'l1'] });
		expect(recentsPuts()).toHaveLength(0);

		await vi.runAllTimersAsync();
		expect(recentsPuts()).toEqual([
			['mail_recents', { move: ['f1', 'archive'], labels: ['l3', 'l2', 'l1'] }]
		]);
	});

	it('drops a pending write when the account changes', async () => {
		await freshAccount();
		accountSettings.recordRecents('move', ['f1']);
		await freshAccount();
		expect(accountSettings.mailRecents).toEqual({ move: [], labels: [] });
		await vi.runAllTimersAsync();
		expect(recentsPuts()).toHaveLength(0);
	});
});
