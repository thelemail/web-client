import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import SettingsLayout from './+layout.svelte';

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

afterEach(() => cleanup());

describe('settings layout', () => {
	it('renders the shell without appearance preference attributes', () => {
		render(SettingsLayout, { props: { data: { accountId: 'acc-1', slot: 0 }, children } });
		const root = document.querySelector('.settings-app')!;
		expect(root).not.toBeNull();
		expect(root.hasAttribute('data-density')).toBe(false);
		expect(root.hasAttribute('data-accent')).toBe(false);
	});
});
