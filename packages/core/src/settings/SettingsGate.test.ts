import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';

const { getAccountSettings, putAccountSettingsSection } = vi.hoisted(() => ({
	getAccountSettings: vi.fn(),
	putAccountSettingsSection: vi.fn()
}));

vi.mock('$core/api/accountSettings', () => ({ getAccountSettings, putAccountSettingsSection }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { canEnterApp: true, accountId: 'acc-1' } }));
vi.mock('$core/stores/workspaces.svelte', () => ({ workspaces: {} }));
vi.mock('$core/stores/twofactor.svelte', () => ({ twofactor: {} }));

import SettingsGate from './SettingsGate.svelte';
import { accountSettings } from '$core/stores/accountSettings.svelte';
import { settingsDraft } from '$core/stores/settingsDraft.svelte';

const children = createRawSnippet(() => ({ render: () => '<p class="gated">controls</p>' }));

let account = 0;

beforeEach(() => {
	vi.resetAllMocks();
	account += 1;
	accountSettings.setAccount(`gate-${account}`);
	settingsDraft.setAccount(`gate-${account}`);
});

afterEach(() => cleanup());

describe('settings gate', () => {
	it('holds the controls back behind skeleton rows while loading', () => {
		const { container } = render(SettingsGate, { props: { rows: 3, children } });
		const skel = container.querySelector('.set-skel')!;
		expect(skel.getAttribute('aria-busy')).toBe('true');
		expect(skel.querySelectorAll('.setrow')).toHaveLength(3);
		expect(container.querySelector('.gated')).toBeNull();
	});

	it('shows the load failure with a retry that loads the controls', async () => {
		getAccountSettings.mockRejectedValueOnce(new Error('offline'));
		const { container } = render(SettingsGate, { props: { children } });
		await settingsDraft.hydrate();
		await tick();
		expect(screen.getByRole('alert').textContent).toContain('Could not load your settings.');
		expect(container.querySelector('.gated')).toBeNull();

		getAccountSettings.mockResolvedValue({ sections: {} });
		await fireEvent.click(screen.getByRole('button', { name: /try again/i }));
		await vi.waitFor(() => expect(container.querySelector('.gated')).not.toBeNull());
		expect(screen.queryByRole('alert')).toBeNull();
	});
});
