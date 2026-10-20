import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';

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

import Appearance from './Appearance.svelte';
import Region from './Region.svelte';
import Sending from './Sending.svelte';
import Reading from './Reading.svelte';
import Notifications from './Notifications.svelte';
import { accountSettings } from '$core/stores/accountSettings.svelte';
import { settingsDraft } from '$core/stores/settingsDraft.svelte';
import { headingJumps, unnamedControls } from '../a11yAssert';
import { m } from '$paraglide/messages.js';

let account = 0;

beforeEach(async () => {
	vi.resetAllMocks();
	account += 1;
	getAccountSettings.mockResolvedValue({ sections: {} });
	accountSettings.setAccount(`a11y-${account}`);
	settingsDraft.setAccount(`a11y-${account}`);
	await settingsDraft.hydrate();
});

afterEach(() => cleanup());

const draft = () => ({ s: settingsDraft.s, set: settingsDraft.set });

describe('settings sections accessibility', () => {
	it.each([
		['appearance', () => render(Appearance)],
		['region', () => render(Region, { props: draft() })],
		['sending', () => render(Sending, { props: draft() })],
		['reading', () => render(Reading, { props: draft() })],
		['notifications', () => render(Notifications)]
	])('%s names every control and keeps heading order under the page h1', (_, mount) => {
		const { container } = mount();
		expect(unnamedControls(container)).toEqual([]);
		expect(headingJumps(container, 1)).toEqual([]);
		expect(container.querySelector('h3, h4')).toBeNull();
	});

	it('names toggles by their row and describes them by its text', () => {
		render(Sending, { props: draft() });
		const external = screen.getByRole('switch', { name: m.settings_sending_confirm_external() });
		const descId = external.getAttribute('aria-describedby')!;
		expect(document.getElementById(descId)!.textContent).toBe(m.settings_sending_confirm_external_desc());
		screen.getByRole('switch', { name: m.settings_sending_warn_subject() });
		screen.getByRole('switch', { name: m.settings_sending_warn_unencrypted() });
	});

	it('exposes segmented controls as named radio groups with the selection', () => {
		render(Region, { props: draft() });
		const dates = screen.getByRole('radiogroup', { name: m.settings_region_date_format() });
		const checked = dates.querySelectorAll('[role="radio"][aria-checked="true"]');
		expect(checked).toHaveLength(1);
		screen.getByRole('radiogroup', { name: m.settings_region_time_format() });
		screen.getByRole('combobox', { name: m.settings_region_language() });
	});

	it('names the reading select by its row', () => {
		render(Reading, { props: draft() });
		screen.getByRole('combobox', { name: m.settings_reading_mark_read() });
	});
});
