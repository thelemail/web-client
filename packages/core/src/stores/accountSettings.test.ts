import { describe, it, expect, vi, beforeEach } from 'vitest';

const getAccountSettings = vi.fn();
const putAccountSettingsSection = vi.fn();

vi.mock('$core/api/accountSettings', () => ({
	getAccountSettings: (...a: unknown[]) => getAccountSettings(...a),
	putAccountSettingsSection: (...a: unknown[]) => putAccountSettingsSection(...a)
}));

vi.mock('./auth.svelte', () => ({
	auth: { canEnterApp: true, accountId: 'acc-1' }
}));

import { accountSettings } from './accountSettings.svelte';
import { theme } from './theme.svelte';

let account = 0;

async function hydrateWith(sections: Record<string, Record<string, unknown>>) {
	account += 1;
	getAccountSettings.mockResolvedValue({ sections });
	accountSettings.setAccount(`acc-${account}`);
	await accountSettings.hydrate();
}

beforeEach(() => {
	vi.resetAllMocks();
	putAccountSettingsSection.mockResolvedValue({});
});

describe('appearance settings', () => {
	it('keeps only the theme from a stored appearance section', async () => {
		await hydrateWith({ appearance: { theme: 'dark', density: 'compact', accent: 'bold' } });
		expect(accountSettings.appearance).toEqual({ theme: 'dark' });
		expect(theme.pref).toBe('dark');
	});

	it('saves the theme as the whole appearance section', async () => {
		await hydrateWith({ appearance: { theme: 'light', density: 'compact' } });
		await accountSettings.persistAppearance({ theme: 'auto' });
		expect(putAccountSettingsSection).toHaveBeenCalledTimes(1);
		expect(putAccountSettingsSection).toHaveBeenCalledWith('appearance', { theme: 'auto' });
	});
});
