import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import SettingsLayout from './+layout.svelte';
import { settingsDraft } from '$core/stores/settingsDraft.svelte';

vi.mock('$app/navigation', () => ({
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	replaceState: vi.fn(),
	goto: vi.fn()
}));
vi.mock('openpgp', () => ({}));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribe: vi.fn() } }));
vi.mock('$core/directory/signing-key', () => ({
	DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED: '',
	DIRECTORY_SIGNING_KEY_FINGERPRINT_HEX: ''
}));
vi.mock('$core/directory/lookup', () => ({ lookupDirectory: vi.fn() }));
vi.mock('$core/directory/verify', () => ({
	verifyDirectoryLookup: vi.fn(),
	DirectoryVerificationError: class extends Error {}
}));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/state', () => ({
	page: { params: { slot: '0' }, url: new URL('http://localhost/u/0/settings/appearance') }
}));

const children = createRawSnippet(() => ({ render: () => '<p>section</p>' }));

beforeAll(() => {
	Element.prototype.scrollTo = () => {};
});

afterEach(() => {
	cleanup();
	settingsDraft.setAccount(null);
});

describe('settings layout', () => {
	it('renders the shell without appearance preference attributes', () => {
		render(SettingsLayout, { props: { data: { accountId: 'acc-1', slot: 0 }, children } });
		const root = document.querySelector('.settings-app')!;
		expect(root).not.toBeNull();
		expect(root.hasAttribute('data-density')).toBe(false);
		expect(root.hasAttribute('data-accent')).toBe(false);
	});

	it('shows a failed save with an alert icon and danger styling, never the success check', async () => {
		const { container } = render(SettingsLayout, {
			props: { data: { accountId: 'acc-1', slot: 0 }, children }
		});
		settingsDraft.flash('Could not save your changes. Trying again.', 'error');
		await tick();
		const toast = container.ownerDocument.querySelector('.set-toast')!;
		expect(toast.classList.contains('err')).toBe(true);
		expect(toast.querySelector('.lucide-circle-check')).toBeNull();
		expect(toast.querySelector('.lucide-circle-alert')).not.toBeNull();
	});

	it('keeps the success check for a successful toast', async () => {
		const { container } = render(SettingsLayout, {
			props: { data: { accountId: 'acc-1', slot: 0 }, children }
		});
		settingsDraft.flash('Done');
		await tick();
		const toast = container.ownerDocument.querySelector('.set-toast')!;
		expect(toast.classList.contains('err')).toBe(false);
		expect(toast.querySelector('.lucide-circle-check')).not.toBeNull();
	});

	it('keeps a not saved state with a retry in the indicator after a failed save', async () => {
		const retry = vi.spyOn(settingsDraft, 'retrySave').mockImplementation(() => {});
		const { container } = render(SettingsLayout, {
			props: { data: { accountId: 'acc-1', slot: 0 }, children }
		});
		settingsDraft.saveState = 'error';
		await tick();
		const indicator = container.querySelector('.autosave')!;
		expect(indicator.classList.contains('error')).toBe(true);
		expect(indicator.textContent).toContain('Not saved');
		expect(indicator.querySelector('.lucide-check')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: /not saved, try again/i }));
		expect(retry).toHaveBeenCalled();
		retry.mockRestore();
	});
});
