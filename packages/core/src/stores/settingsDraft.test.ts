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

	it('saves over the stored section once a failed load is retried', async () => {
		account += 1;
		getAccountSettings.mockRejectedValueOnce(new Error('offline'));
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		await settingsDraft.hydrate();
		getAccountSettings.mockResolvedValue({
			sections: { reading_open_message: { markRead: 2000, images: 'ask' } }
		});
		putAccountSettingsSection.mockClear();
		expect(await saveMarkRead('immediately')).toEqual([]);
		await settingsDraft.retryLoad();
		await vi.advanceTimersByTimeAsync(0);
		expect(putAccountSettingsSection.mock.calls).toEqual([
			['reading_open_message', { markRead: 0, images: 'ask' }]
		]);
	});

	it('does not save when the section cannot be loaded', async () => {
		account += 1;
		getAccountSettings.mockRejectedValue(new Error('offline'));
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		await settingsDraft.hydrate();
		putAccountSettingsSection.mockClear();
		expect(await saveMarkRead('after_2s')).toEqual([]);
		settingsDraft.flushPending();
		await vi.advanceTimersByTimeAsync(0);
		expect(putAccountSettingsSection).not.toHaveBeenCalled();
		expect(settingsDraft.saveState).toBe('error');
	});

	it('keeps other keys when the change lands before hydrate', async () => {
		account += 1;
		getAccountSettings.mockResolvedValue({
			sections: { reading_open_message: { markRead: 2000, images: 'contacts' } }
		});
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		expect(await saveMarkRead('immediately')).toEqual([]);
		await settingsDraft.hydrate();
		await vi.advanceTimersByTimeAsync(0);
		expect(putAccountSettingsSection.mock.calls).toEqual([
			['reading_open_message', { markRead: 0, images: 'contacts' }]
		]);
		expect(settingsDraft.s.markRead).toBe('immediately');
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

function deferred<T>() {
	let resolve: (v: T) => void = () => {};
	let reject: (e: unknown) => void = () => {};
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function hydrateSections(sections: Record<string, Record<string, unknown>>) {
	account += 1;
	getAccountSettings.mockResolvedValue({ sections });
	accountSettings.setAccount(`acc-${account}`);
	settingsDraft.setAccount(`acc-${account}`);
	await settingsDraft.hydrate();
	putAccountSettingsSection.mockClear();
}

function putsFor(section: string) {
	return putAccountSettingsSection.mock.calls
		.filter(([name]) => name === section)
		.map(([, body]) => body);
}

describe('settings load state', () => {
	it('stays unloaded with the error after a failed load, and a retry loads it', async () => {
		account += 1;
		const offline = new Error('offline');
		getAccountSettings.mockRejectedValueOnce(offline);
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		await settingsDraft.hydrate();
		expect(accountSettings.status).toBe('error');
		expect(accountSettings.hydrated).toBe(false);
		expect(accountSettings.error).toBe(offline);

		getAccountSettings.mockResolvedValue({ sections: { localization: { timeFormat: '12' } } });
		await settingsDraft.retryLoad();
		expect(accountSettings.status).toBe('ready');
		expect(settingsDraft.s.timeFmt).toBe('12');
	});

	it('retries the load when the browser comes back online', async () => {
		account += 1;
		getAccountSettings.mockRejectedValueOnce(new Error('offline'));
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		await settingsDraft.hydrate();
		getAccountSettings.mockResolvedValue({ sections: {} });
		window.dispatchEvent(new Event('online'));
		await vi.advanceTimersByTimeAsync(0);
		expect(accountSettings.status).toBe('ready');
	});

	it('sends no defaults for sibling keys when a change lands before the load resolves', async () => {
		account += 1;
		const load = deferred<unknown>();
		getAccountSettings.mockReturnValue(load.promise);
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		const hydrating = settingsDraft.hydrate();
		settingsDraft.set('dateFmt', 'iso');
		await vi.advanceTimersByTimeAsync(1000);
		expect(putAccountSettingsSection).not.toHaveBeenCalled();

		load.resolve({ sections: { localization: { dateFormat: 'dmy', timeFormat: '12' } } });
		await hydrating;
		await vi.advanceTimersByTimeAsync(0);
		expect(putsFor('localization')).toEqual([{ dateFormat: 'iso', timeFormat: '12' }]);
		expect(settingsDraft.s.dateFmt).toBe('iso');
		expect(settingsDraft.s.timeFmt).toBe('12');
	});

	it('does not put a section after a failed load', async () => {
		account += 1;
		getAccountSettings.mockRejectedValue(new Error('offline'));
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		await settingsDraft.hydrate();
		settingsDraft.set('confirmSubject', false);
		await vi.advanceTimersByTimeAsync(5000);
		expect(putAccountSettingsSection).not.toHaveBeenCalled();
	});

	it('keeps an edit made while the load is in flight and persists it', async () => {
		account += 1;
		const load = deferred<unknown>();
		getAccountSettings.mockReturnValue(load.promise);
		accountSettings.setAccount(`acc-${account}`);
		settingsDraft.setAccount(`acc-${account}`);
		const hydrating = settingsDraft.hydrate();
		settingsDraft.set('replyDefault', 'all');
		load.resolve({
			sections: {
				composing: {
					replyDefault: 'reply',
					confirmExternal: false,
					confirmSubject: true,
					confirmUnencrypted: true
				}
			}
		});
		await hydrating;
		expect(settingsDraft.s.replyDefault).toBe('all');
		expect(settingsDraft.s.confirmExternal).toBe(false);
		await vi.advanceTimersByTimeAsync(1000);
		expect(putsFor('composing')).toEqual([
			{ replyDefault: 'all', confirmExternal: false, confirmSubject: true, confirmUnencrypted: true }
		]);
	});
});

describe('refresh while saving', () => {
	it('keeps an edit whose save is still in flight when settings refresh', async () => {
		await hydrateSections({ localization: { dateFormat: 'dmy', timeFormat: '24' } });
		const put = deferred<unknown>();
		putAccountSettingsSection.mockReturnValueOnce(put.promise);
		settingsDraft.set('timeFmt', '12');
		await vi.advanceTimersByTimeAsync(700);
		getAccountSettings.mockResolvedValue({
			sections: { localization: { dateFormat: 'mdy', timeFormat: '24' } }
		});
		await accountSettings.refresh();
		expect(settingsDraft.s.timeFmt).toBe('12');
		expect(settingsDraft.s.dateFmt).toBe('mdy');
		put.resolve({});
		await vi.advanceTimersByTimeAsync(0);
		expect(settingsDraft.saveState).toBe('saved');
	});
});

describe('section bodies', () => {
	it.each([
		['privacy', { stripTrackingParams: true, shareSpamHeaders: true, future: 1 }, 'stripTrack', false],
		['composing', { replyDefault: 'reply', future: 1 }, 'replyDefault', 'all'],
		['localization', { dateFormat: 'dmy', timeFormat: '12', future: 1 }, 'dateFmt', 'iso']
	] as const)('keeps a %s key the client does not edit', async (section, stored, key, value) => {
		await hydrateSections({ [section]: { ...stored } });
		settingsDraft.set(key, value as never);
		await vi.advanceTimersByTimeAsync(1000);
		const [body] = putsFor(section);
		expect(body).toMatchObject({ future: 1 });
	});

	it('keeps other calendar keys when the reminder default changes', async () => {
		await hydrateSections({
			calendar: { hidden: ['c1'], weekStartsOn: 0, startHour: 8, future: 1 }
		});
		settingsDraft.setReminderDefault(30);
		await vi.advanceTimersByTimeAsync(1000);
		expect(putsFor('calendar')).toEqual([
			expect.objectContaining({
				hidden: ['c1'],
				weekStartsOn: 0,
				startHour: 8,
				defaultReminderMinutes: 30,
				future: 1
			})
		]);
	});
});

describe('save feedback', () => {
	it('shows saving, then saved, then idle on success', async () => {
		await hydrateSections({});
		settingsDraft.set('timeFmt', '12');
		expect(settingsDraft.saveState).toBe('saving');
		await vi.advanceTimersByTimeAsync(700);
		expect(settingsDraft.saveState).toBe('saved');
		await vi.advanceTimersByTimeAsync(3000);
		expect(settingsDraft.saveState).toBe('idle');
		expect(settingsDraft.toast).toBeNull();
	});

	it('sets the error state and an error toast when a save fails', async () => {
		await hydrateSections({});
		putAccountSettingsSection.mockRejectedValue(new Error('500'));
		settingsDraft.set('timeFmt', '12');
		await vi.advanceTimersByTimeAsync(700);
		expect(settingsDraft.saveState).toBe('error');
		expect(settingsDraft.toast?.kind).toBe('error');
		expect(settingsDraft.s.timeFmt).toBe('12');
	});

	it('retries on a backoff timer and clears the error once a retry succeeds', async () => {
		await hydrateSections({ localization: { dateFormat: 'mdy' } });
		putAccountSettingsSection.mockRejectedValueOnce(new Error('500'));
		putAccountSettingsSection.mockRejectedValueOnce(new Error('500'));
		settingsDraft.set('timeFmt', '12');
		await vi.advanceTimersByTimeAsync(700);
		expect(putAccountSettingsSection).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(2000);
		expect(putAccountSettingsSection).toHaveBeenCalledTimes(2);
		expect(settingsDraft.saveState).toBe('error');
		await vi.advanceTimersByTimeAsync(3899);
		expect(putAccountSettingsSection).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(putAccountSettingsSection).toHaveBeenCalledTimes(3);
		expect(putsFor('localization').at(-1)).toEqual({ dateFormat: 'mdy', timeFormat: '12' });
		expect(settingsDraft.saveState).toBe('saved');
	});

	it('retries a failed save when the browser comes back online', async () => {
		await hydrateSections({});
		putAccountSettingsSection.mockRejectedValueOnce(new Error('offline'));
		settingsDraft.set('confirmExternal', false);
		await vi.advanceTimersByTimeAsync(700);
		expect(settingsDraft.saveState).toBe('error');
		window.dispatchEvent(new Event('online'));
		await vi.advanceTimersByTimeAsync(0);
		expect(putAccountSettingsSection).toHaveBeenCalledTimes(2);
		expect(settingsDraft.saveState).toBe('saved');
	});

	it('saves the theme through the indicator and keeps an unsaved theme marked as not saved', async () => {
		await hydrateSections({ appearance: { theme: 'light' } });
		putAccountSettingsSection.mockRejectedValueOnce(new Error('500'));
		settingsDraft.setTheme('dark');
		expect(settingsDraft.saveState).toBe('saving');
		await vi.advanceTimersByTimeAsync(700);
		expect(settingsDraft.saveState).toBe('error');
		expect(accountSettings.appearance.theme).toBe('dark');
		await vi.advanceTimersByTimeAsync(2000);
		expect(putsFor('appearance')).toEqual([{ theme: 'dark' }, { theme: 'dark' }]);
		expect(settingsDraft.saveState).toBe('saved');
	});
});
