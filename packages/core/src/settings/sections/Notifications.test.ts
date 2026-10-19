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
vi.mock('$platform', () => ({ platform: { notifications: null, openExternal: vi.fn() } }));
vi.mock('$core/calendar/reminders', () => ({
	reminderPermission: () => 'granted',
	requestReminderPermission: vi.fn()
}));

import Notifications from './Notifications.svelte';
import { accountSettings } from '$core/stores/accountSettings.svelte';
import { settingsDraft } from '$core/stores/settingsDraft.svelte';

let account = 0;

beforeEach(async () => {
	vi.resetAllMocks();
	vi.useFakeTimers();
	account += 1;
	getAccountSettings.mockResolvedValue({
		sections: { calendar: { defaultReminderMinutes: 10, hidden: ['c1'] } }
	});
	accountSettings.setAccount(`notify-${account}`);
	settingsDraft.setAccount(`notify-${account}`);
	await settingsDraft.hydrate();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe('notifications section', () => {
	it('marks a reminder default the server refused as not saved and retries it', async () => {
		putAccountSettingsSection.mockRejectedValueOnce(new Error('500'));
		render(Notifications);
		const select = screen.getByLabelText(/reminder/i) as HTMLSelectElement;
		await fireEvent.change(select, { target: { value: '30' } });
		expect(settingsDraft.saveState).toBe('saving');

		await vi.advanceTimersByTimeAsync(700);
		expect(settingsDraft.saveState).toBe('error');
		expect(settingsDraft.toast?.kind).toBe('error');
		expect(select.value).toBe('30');

		putAccountSettingsSection.mockResolvedValue({});
		await vi.advanceTimersByTimeAsync(2000);
		expect(putAccountSettingsSection).toHaveBeenLastCalledWith(
			'calendar',
			expect.objectContaining({ defaultReminderMinutes: 30, hidden: ['c1'] })
		);
		expect(settingsDraft.saveState).toBe('saved');
	});
});
