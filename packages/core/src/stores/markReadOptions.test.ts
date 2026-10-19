import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('$paraglide/messages.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$paraglide/messages.js')>();
	return {
		...actual,
		m: {
			...actual.m,
			settings_reading_mark_read_immediately: () => 'Straight away',
			settings_reading_mark_read_2s: () => 'In a moment',
			settings_reading_mark_read_never: () => 'Only by hand'
		}
	};
});

import {
	accountSettings,
	isMarkReadOption,
	MARK_READ_DELAYS,
	MARK_READ_LABELS,
	type MarkReadOption
} from './accountSettings.svelte';
import { settingsDraft } from './settingsDraft.svelte';

let account = 0;

beforeEach(async () => {
	vi.resetAllMocks();
	vi.useFakeTimers();
	putAccountSettingsSection.mockResolvedValue({});
	getAccountSettings.mockResolvedValue({
		sections: { reading_open_message: { markRead: 2000, images: 'ask' } }
	});
	account += 1;
	accountSettings.setAccount(`acc-${account}`);
	settingsDraft.setAccount(`acc-${account}`);
	await settingsDraft.hydrate();
	putAccountSettingsSection.mockClear();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('mark read options', () => {
	it('keys options by id, not by label text', () => {
		const options = Object.entries(MARK_READ_LABELS).map(([v, l]) => ({ v, l: l() }));
		expect(options).toEqual([
			{ v: 'immediately', l: 'Straight away' },
			{ v: 'after_2s', l: 'In a moment' },
			{ v: 'never', l: 'Only by hand' }
		]);
	});

	it('rejects label text as an option', () => {
		expect(isMarkReadOption('In a moment')).toBe(false);
		expect(isMarkReadOption('After 2 seconds')).toBe(false);
		expect(isMarkReadOption('toString')).toBe(false);
		expect(Object.keys(MARK_READ_DELAYS).every(isMarkReadOption)).toBe(true);
	});

	it.each([
		['immediately', 0],
		['after_2s', 2000],
		['never', null]
	] as const)('stores %s as %j whatever the label says', async (option: MarkReadOption, ms) => {
		settingsDraft.set('markRead', option);
		await vi.advanceTimersByTimeAsync(1000);
		expect(putAccountSettingsSection).toHaveBeenCalledWith('reading_open_message', {
			markRead: ms,
			images: 'ask'
		});
		expect(accountSettings.markReadDelayMs).toBe(ms);
	});
});
