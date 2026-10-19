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
	markRead: 'reading_open_message',
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

async function hydrateReading(reading: Record<string, unknown> | undefined) {
	account += 1;
	getAccountSettings.mockResolvedValue({
		sections: reading ? { reading_open_message: reading } : {}
	});
	accountSettings.setAccount(`acc-${account}`);
	settingsDraft.setAccount(`acc-${account}`);
	await settingsDraft.hydrate();
	putAccountSettingsSection.mockClear();
}

async function saveMarkRead(label: string) {
	settingsDraft.set('markRead', label);
	await vi.advanceTimersByTimeAsync(1000);
	return putAccountSettingsSection.mock.calls
		.filter(([section]) => section === 'reading_open_message')
		.map(([, body]) => body);
}

describe('reading open message', () => {
	it('sends the delay in milliseconds and no swipe', async () => {
		await hydrateReading(undefined);
		expect(await saveMarkRead('After 5 seconds')).toEqual([{ markRead: 5000 }]);
	});

	it('sends null for never and zero for immediately', async () => {
		await hydrateReading(undefined);
		expect(await saveMarkRead('Never automatically')).toEqual([{ markRead: null }]);
		putAccountSettingsSection.mockClear();
		expect(await saveMarkRead('Immediately on open')).toEqual([{ markRead: 0 }]);
	});

	it('keeps keys written by other clients', async () => {
		await hydrateReading({ markRead: 2000, images: 'ask', swipe: 'Delete' });
		expect(await saveMarkRead('Immediately on open')).toEqual([
			{ markRead: 0, images: 'ask', swipe: 'Delete' }
		]);
	});

	it('never adds a swipe the section did not have', async () => {
		await hydrateReading({ markRead: 2000, images: 'always' });
		const [body] = await saveMarkRead('After 5 seconds');
		expect(body).not.toHaveProperty('swipe');
		expect(body).toEqual({ markRead: 5000, images: 'always' });
	});

	it('keeps other keys across consecutive saves', async () => {
		await hydrateReading({ markRead: 0, images: 'contacts' });
		await saveMarkRead('After 5 seconds');
		putAccountSettingsSection.mockClear();
		expect(await saveMarkRead('Never automatically')).toEqual([
			{ markRead: null, images: 'contacts' }
		]);
	});

	it.each([
		[2000, 'After 2 seconds', 2000],
		[0, 'Immediately on open', 0],
		[null, 'Never automatically', null],
		['After 5 seconds', 'After 5 seconds', 5000],
		['Never automatically', 'Never automatically', null],
		[1234, 'After 2 seconds', 2000],
		['toString', 'After 2 seconds', 2000]
	])('reads markRead %j as %s', async (raw, label, delay) => {
		await hydrateReading({ markRead: raw });
		expect(settingsDraft.s.markRead).toBe(label);
		expect(accountSettings.markReadDelayMs).toBe(delay);
	});

	it('falls back to the default when the section or key is missing', async () => {
		await hydrateReading(undefined);
		expect(settingsDraft.s.markRead).toBe('After 2 seconds');
		await hydrateReading({ images: 'ask' });
		expect(settingsDraft.s.markRead).toBe('After 2 seconds');
		expect(accountSettings.markReadDelayMs).toBe(2000);
	});

	it('forgets the previous account section on switch', async () => {
		await hydrateReading({ markRead: 0, images: 'always' });
		await hydrateReading(undefined);
		expect(await saveMarkRead('After 5 seconds')).toEqual([{ markRead: 5000 }]);
	});
});
