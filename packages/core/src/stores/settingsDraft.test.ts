import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SETTINGS_DEFAULTS, type SettingsState } from '$core/settings/data';

const getAccountSettings = vi.fn();
const putAccountSettingsSection = vi.fn();

vi.mock('$core/api/accountSettings', () => ({
	getAccountSettings: (...a: unknown[]) => getAccountSettings(...a),
	putAccountSettingsSection: (...a: unknown[]) => putAccountSettingsSection(...a)
}));

vi.mock('./auth.svelte', () => ({
	auth: { canEnterApp: true, accountId: 'acc-1' }
}));

vi.mock('./workspaces.svelte', () => ({ workspaces: {} }));
vi.mock('./twofactor.svelte', () => ({ twofactor: {} }));

import { accountSettings } from './accountSettings.svelte';
import { settingsDraft } from './settingsDraft.svelte';

const SECTION_BY_KEY: Partial<Record<keyof SettingsState, string>> = {
	replyDefault: 'composing',
	confirmExternal: 'composing',
	confirmSubject: 'composing',
	confirmUnencrypted: 'composing',
	density: 'appearance',
	markRead: 'reading_open_message',
	swipe: 'reading_open_message',
	stripTrack: 'privacy',
	shareSpamHeaders: 'privacy',
	dateFmt: 'localization',
	timeFmt: 'localization'
};

const LOCAL_ONLY: ReadonlyArray<keyof SettingsState> = [];

const KEYS = Object.keys(SETTINGS_DEFAULTS) as (keyof SettingsState)[];

let account = 0;

async function freshAccount() {
	account += 1;
	getAccountSettings.mockResolvedValue({ sections: {} });
	accountSettings.setAccount(`acc-${account}`);
	settingsDraft.setAccount(`acc-${account}`);
	await settingsDraft.hydrate();
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.useFakeTimers();
	putAccountSettingsSection.mockResolvedValue({});
});

afterEach(() => {
	vi.useRealTimers();
});

describe('settings draft persistence', () => {
	it('maps every settings key to a section or the local-only list', () => {
		const unmapped = KEYS.filter((k) => !SECTION_BY_KEY[k] && !LOCAL_ONLY.includes(k));
		expect(unmapped).toEqual([]);
		const stale = Object.keys(SECTION_BY_KEY).filter((k) => !KEYS.includes(k as keyof SettingsState));
		expect(stale).toEqual([]);
	});

	it.each(KEYS.filter((k) => !LOCAL_ONLY.includes(k)))('saves %s to its section', async (key) => {
		await freshAccount();
		putAccountSettingsSection.mockClear();
		settingsDraft.set(key, SETTINGS_DEFAULTS[key]);
		await vi.advanceTimersByTimeAsync(1000);
		const sections = putAccountSettingsSection.mock.calls.map(([section]) => section);
		expect(sections).toContain(SECTION_BY_KEY[key]);
	});

	it.each(LOCAL_ONLY)('keeps %s local', async (key) => {
		await freshAccount();
		putAccountSettingsSection.mockClear();
		settingsDraft.set(key, SETTINGS_DEFAULTS[key]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(putAccountSettingsSection).not.toHaveBeenCalled();
	});
});
