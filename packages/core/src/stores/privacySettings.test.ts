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

vi.mock('./workspaces.svelte', () => ({ workspaces: {} }));
vi.mock('./twofactor.svelte', () => ({ twofactor: {} }));

import { accountSettings } from './accountSettings.svelte';
import { settingsDraft } from './settingsDraft.svelte';

let account = 0;

async function freshAccount(privacy: Record<string, unknown> | undefined) {
	account += 1;
	getAccountSettings.mockResolvedValue({ sections: privacy ? { privacy } : {} });
	accountSettings.setAccount(`acc-${account}`);
	settingsDraft.setAccount(`acc-${account}`);
	await settingsDraft.hydrate();
}

function privacyPuts() {
	return putAccountSettingsSection.mock.calls.filter(([section]) => section === 'privacy');
}

beforeEach(() => {
	vi.resetAllMocks();
	putAccountSettingsSection.mockResolvedValue({});
});

describe('privacy settings', () => {
	it('starts unanswered when the account has never been asked', async () => {
		await freshAccount(undefined);
		expect(accountSettings.privacy.shareSpamHeaders).toBeNull();
	});

	it('reads a saved answer', async () => {
		await freshAccount({ stripTrackingParams: false, shareSpamHeaders: true });
		expect(accountSettings.privacy).toEqual({ stripTrackingParams: false, shareSpamHeaders: true });
		expect(settingsDraft.s.shareSpamHeaders).toBe(true);
	});

	it('keeps tracking-link stripping when the consent answer is saved', async () => {
		await freshAccount({ stripTrackingParams: false });
		await accountSettings.persistShareSpamHeaders(false);
		expect(privacyPuts()).toEqual([
			['privacy', { stripTrackingParams: false, shareSpamHeaders: false }]
		]);
		expect(accountSettings.privacy.shareSpamHeaders).toBe(false);
	});

	it('does not answer the consent question when only tracking stripping changes', async () => {
		await freshAccount({ stripTrackingParams: true });
		settingsDraft.set('stripTrack', false);
		await settingsDraft.flushAll();
		expect(privacyPuts()).toEqual([
			['privacy', { stripTrackingParams: false, shareSpamHeaders: null }]
		]);
		expect(accountSettings.privacy.shareSpamHeaders).toBeNull();
	});

	it('keeps a consent answer given in the mail view when settings save later', async () => {
		await freshAccount({ stripTrackingParams: true });
		await accountSettings.persistShareSpamHeaders(true);
		settingsDraft.set('stripTrack', false);
		await settingsDraft.flushAll();
		expect(privacyPuts().at(-1)).toEqual([
			'privacy',
			{ stripTrackingParams: false, shareSpamHeaders: true }
		]);
	});

	it('saves the toggle from settings', async () => {
		await freshAccount({ stripTrackingParams: true, shareSpamHeaders: false });
		settingsDraft.set('shareSpamHeaders', true);
		await settingsDraft.flushAll();
		expect(privacyPuts()).toEqual([
			['privacy', { stripTrackingParams: true, shareSpamHeaders: true }]
		]);
		expect(accountSettings.privacy.shareSpamHeaders).toBe(true);
	});
});
