import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';

const { getAccountSettings, putAccountSettingsSection } = vi.hoisted(() => ({
	getAccountSettings: vi.fn(),
	putAccountSettingsSection: vi.fn()
}));

vi.mock('$core/api/accountSettings', () => ({ getAccountSettings, putAccountSettingsSection }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { canEnterApp: true, accountId: 'acc-1' } }));
vi.mock('$core/stores/workspaces.svelte', () => ({ workspaces: {} }));
vi.mock('$core/stores/twofactor.svelte', () => ({ twofactor: {} }));

import Appearance from './Appearance.svelte';
import { accountSettings } from '$core/stores/accountSettings.svelte';
import { settingsDraft } from '$core/stores/settingsDraft.svelte';
import { theme } from '$core/stores/theme.svelte';

let account = 0;

beforeEach(async () => {
	vi.resetAllMocks();
	vi.useFakeTimers();
	account += 1;
	getAccountSettings.mockResolvedValue({ sections: { appearance: { theme: 'light' } } });
	accountSettings.setAccount(`appearance-${account}`);
	settingsDraft.setAccount(`appearance-${account}`);
	await settingsDraft.hydrate();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('appearance section', () => {
	it('marks a theme the server refused as not saved and retries it', async () => {
		putAccountSettingsSection.mockRejectedValueOnce(new Error('500'));
		render(Appearance);
		await fireEvent.click(screen.getByRole('radio', { name: /inkwell/i }));
		expect(theme.pref).toBe('dark');
		expect(settingsDraft.saveState).toBe('saving');

		await vi.advanceTimersByTimeAsync(700);
		expect(settingsDraft.saveState).toBe('error');
		expect(settingsDraft.toast?.kind).toBe('error');

		putAccountSettingsSection.mockResolvedValue({});
		await vi.advanceTimersByTimeAsync(2000);
		expect(putAccountSettingsSection).toHaveBeenLastCalledWith('appearance', { theme: 'dark' });
		expect(settingsDraft.saveState).toBe('saved');
	});
});
