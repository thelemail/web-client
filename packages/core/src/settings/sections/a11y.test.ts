import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';

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

describe('settings section content', () => {
	function cardsWithoutContent(container: HTMLElement): string[] {
		return [...container.querySelectorAll<HTMLElement>('.scard')]
			.filter((card) => [...card.children].every((c) => c.classList.contains('scard-h')))
			.map((card) => card.querySelector('.scard-title')?.textContent ?? '?');
	}

	it('puts the primary reply button under reading, where it still saves', async () => {
		render(Reading, { props: draft() });
		const group = screen.getByRole('radiogroup', { name: m.settings_sending_reply_button() });
		await fireEvent.click(within(group).getByRole('radio', { name: m.settings_sending_reply_all() }));
		expect(settingsDraft.s.replyDefault).toBe('all');
	});

	it('describes reading in a full sentence', () => {
		const { container } = render(Reading, { props: draft() });
		const desc = container.querySelector('.sec-h p')!.textContent!;
		expect(desc).toBe(m.settings_reading_desc());
		expect(desc.split(' ').length).toBeGreaterThan(6);
	});

	it('leaves only the safety checks under sending', () => {
		const { container } = render(Sending, { props: draft() });
		expect(screen.queryByRole('radiogroup', { name: m.settings_sending_reply_button() })).toBeNull();
		expect(container.querySelectorAll('.scard')).toHaveLength(1);
		expect(screen.getAllByRole('switch')).toHaveLength(3);
	});

	it('tells web visitors new mail alerts come from the desktop app, with no empty row', () => {
		render(Notifications);
		const heading = screen.getByRole('heading', { name: m.settings_notify_new_mail() });
		const card = heading.closest('.scard')!;
		expect(card.textContent).toContain(m.settings_notify_desktop_only());
		expect(card.querySelector('.setrow')).toBeNull();
	});

	it.each([
		['appearance', () => render(Appearance)],
		['region', () => render(Region, { props: draft() })],
		['sending', () => render(Sending, { props: draft() })],
		['reading', () => render(Reading, { props: draft() })],
		['notifications', () => render(Notifications)]
	])('%s renders no empty card', (_, mount) => {
		const { container } = mount();
		expect(cardsWithoutContent(container)).toEqual([]);
	});
});
