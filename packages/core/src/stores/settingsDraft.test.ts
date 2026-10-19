import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SETTINGS_DEFAULTS, type SettingsState } from '$core/settings/data';
import type { MarkReadOption } from './accountSettings.svelte';

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

async function saveMarkRead(option: MarkReadOption) {
	settingsDraft.set('markRead', option);
	await vi.advanceTimersByTimeAsync(1000);
	return putAccountSettingsSection.mock.calls
		.filter(([section]) => section === 'reading_open_message')
		.map(([, body]) => body);
}

describe('reading open message', () => {
	it('sends the delay in milliseconds and no swipe', async () => {
		await hydrateReading(undefined);
		expect(await saveMarkRead('after_2s')).toEqual([{ markRead: 2000 }]);
	});

	it('sends null for never and zero for immediately', async () => {
		await hydrateReading(undefined);
		expect(await saveMarkRead('never')).toEqual([{ markRead: null }]);
		putAccountSettingsSection.mockClear();
		expect(await saveMarkRead('immediately')).toEqual([{ markRead: 0 }]);
	});

	it('keeps keys written by other clients', async () => {
		await hydrateReading({ markRead: 2000, images: 'ask', swipe: 'Delete' });
		expect(await saveMarkRead('immediately')).toEqual([
			{ markRead: 0, images: 'ask', swipe: 'Delete' }
		]);
	});

	it('never adds a swipe the section did not have', async () => {
		await hydrateReading({ markRead: 2000, images: 'always' });
		const [body] = await saveMarkRead('after_2s');
		expect(body).not.toHaveProperty('swipe');
		expect(body).toEqual({ markRead: 2000, images: 'always' });
	});

	it('keeps other keys across consecutive saves', async () => {
		await hydrateReading({ markRead: 0, images: 'contacts' });
		await saveMarkRead('after_2s');
		putAccountSettingsSection.mockClear();
		expect(await saveMarkRead('never')).toEqual([
			{ markRead: null, images: 'contacts' }
		]);
	});

	it.each([
		[0, 'immediately', 0],
		[2000, 'after_2s', 2000],
		[null, 'never', null],
		['Immediately on open', 'immediately', 0],
		['After 2 seconds', 'after_2s', 2000],
		['After 5 seconds', 'after_2s', 2000],
		['Never automatically', 'never', null],
		[5000, 'after_2s', 2000],
		[1234, 'after_2s', 2000],
		[-1, 'after_2s', 2000],
		['2000', 'after_2s', 2000],
		['never', 'after_2s', 2000],
		['toString', 'after_2s', 2000],
		[true, 'after_2s', 2000],
		[{}, 'after_2s', 2000]
	])('reads markRead %j as %s', async (raw, option, delay) => {
		await hydrateReading({ markRead: raw });
		expect(settingsDraft.s.markRead).toBe(option);
		expect(accountSettings.markReadDelayMs).toBe(delay);
	});

	it.each([
		['Immediately on open', 'never', null],
		['After 2 seconds', 'immediately', 0],
		['Never automatically', 'after_2s', 2000]
	] as const)('rewrites legacy %s as milliseconds on the next save', async (legacy, option, ms) => {
		await hydrateReading({ markRead: legacy, images: 'contacts' });
		expect(await saveMarkRead(option)).toEqual([{ markRead: ms, images: 'contacts' }]);
	});

	it('falls back to the default when the section or key is missing', async () => {
		await hydrateReading(undefined);
		expect(settingsDraft.s.markRead).toBe('after_2s');
		await hydrateReading({ images: 'ask' });
		expect(settingsDraft.s.markRead).toBe('after_2s');
		expect(accountSettings.markReadDelayMs).toBe(2000);
	});

	it('reloads the section before saving when hydrate failed', async () => {
		account += 1;
		getAccountSettings.mockRejectedValueOnce(new Error('offline'));
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		await settingsDraft.hydrate();
		getAccountSettings.mockResolvedValue({
			sections: { reading_open_message: { markRead: 2000, images: 'ask' } }
		});
		putAccountSettingsSection.mockClear();
		expect(await saveMarkRead('after_2s')).toEqual([{ markRead: 2000, images: 'ask' }]);
	});

	it('does not save when the section cannot be loaded', async () => {
		account += 1;
		getAccountSettings.mockRejectedValue(new Error('offline'));
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		await settingsDraft.hydrate();
		putAccountSettingsSection.mockClear();
		expect(await saveMarkRead('after_2s')).toEqual([]);
		getAccountSettings.mockResolvedValue({
			sections: { reading_open_message: { images: 'always' } }
		});
		settingsDraft.flushPending();
		await vi.advanceTimersByTimeAsync(0);
		expect(putAccountSettingsSection).toHaveBeenCalledWith('reading_open_message', {
			markRead: 2000,
			images: 'always'
		});
	});

	it('keeps other keys when the change lands before hydrate', async () => {
		account += 1;
		getAccountSettings.mockResolvedValue({
			sections: { reading_open_message: { markRead: 2000, images: 'contacts' } }
		});
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		expect(await saveMarkRead('immediately')).toEqual([
			{ markRead: 0, images: 'contacts' }
		]);
	});

	it('does not carry a section into the next account', async () => {
		await hydrateReading({ markRead: 0, images: 'always' });
		let finish: (v: unknown) => void = () => {};
		putAccountSettingsSection.mockImplementationOnce(() => new Promise((r) => (finish = r)));
		settingsDraft.set('markRead', 'after_2s');
		await vi.advanceTimersByTimeAsync(1000);
		account += 1;
		getAccountSettings.mockResolvedValue({ sections: {} });
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		await settingsDraft.hydrate();
		finish({});
		await vi.advanceTimersByTimeAsync(0);
		putAccountSettingsSection.mockClear();
		expect(await saveMarkRead('never')).toEqual([{ markRead: null }]);
		expect(settingsDraft.s.markRead).toBe('never');
	});

	it('forgets the previous account section on switch', async () => {
		await hydrateReading({ markRead: 0, images: 'always' });
		await hydrateReading(undefined);
		expect(await saveMarkRead('after_2s')).toEqual([{ markRead: 2000 }]);
	});
});
