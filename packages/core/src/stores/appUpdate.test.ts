import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AvailableUpdate, UpdateStatus } from '$core/platform/types';

const { native, openExternal } = vi.hoisted(() => ({
	native: {
		status: vi.fn(),
		check: vi.fn(),
		snooze: vi.fn(),
		install: vi.fn(),
		onAvailable: vi.fn(),
		onProgress: vi.fn()
	},
	openExternal: vi.fn()
}));

vi.mock('$platform', () => ({ platform: { updates: native, openExternal } }));

import { appUpdate } from './appUpdate.svelte';
import { holdRestart } from './restartGuard';

const release: AvailableUpdate = {
	version: '0.13.0',
	notes: null,
	publishedAt: null,
	releaseUrl: 'https://github.com/thelemail/desktop-client/releases/tag/v0.13.0'
};

function status(overrides: Partial<UpdateStatus> = {}): UpdateStatus {
	return {
		currentVersion: '0.12.0',
		available: release,
		snoozed: false,
		lastCheck: 1,
		lastFailure: null,
		installing: false,
		blocked: null,
		releasesUrl: 'https://github.com/thelemail/desktop-client/releases',
		...overrides
	};
}

describe('app update store', () => {
	beforeEach(() => {
		Object.values(native).forEach((fn) => fn.mockReset());
		openExternal.mockReset();
		appUpdate.available = null;
		appUpdate.hidden = false;
		appUpdate.installing = false;
		appUpdate.problem = null;
		appUpdate.blockers = [];
	});

	it('keeps a snoozed release out of the banner', async () => {
		native.status.mockResolvedValueOnce(status({ snoozed: true }));
		await appUpdate.refresh();
		expect(appUpdate.available?.version).toBe('0.13.0');
		expect(appUpdate.bannerVisible).toBe(false);
	});

	it('Later hides the banner and snoozes that exact version', async () => {
		native.status.mockResolvedValueOnce(status());
		await appUpdate.refresh();
		expect(appUpdate.bannerVisible).toBe(true);
		await appUpdate.later();
		expect(appUpdate.bannerVisible).toBe(false);
		expect(native.snooze).toHaveBeenCalledWith('0.13.0');
	});

	it('never installs on its own, only when asked', async () => {
		native.status.mockResolvedValueOnce(status());
		await appUpdate.refresh();
		expect(native.install).not.toHaveBeenCalled();
		native.install.mockReturnValueOnce(new Promise(() => {}));
		void appUpdate.install();
		await vi.waitFor(() => expect(native.install).toHaveBeenCalledWith('0.13.0'));
		expect(appUpdate.installing).toBe(true);
	});

	it('does not restart while something unsaved holds it', async () => {
		native.status.mockResolvedValueOnce(status());
		await appUpdate.refresh();
		const release = holdRestart(() => 'A message is still sending.');
		await appUpdate.install();
		expect(native.install).not.toHaveBeenCalled();
		expect(appUpdate.blockers).toEqual(['A message is still sending.']);
		release();
	});

	it('explains a refused install and lets the user try again', async () => {
		native.status.mockResolvedValueOnce(status());
		await appUpdate.refresh();
		native.install.mockRejectedValueOnce({ code: 'verify', detail: 'bad signature' });
		await appUpdate.install();
		expect(appUpdate.installing).toBe(false);
		expect(appUpdate.problem).toMatch(/signature checks/);
	});
});
