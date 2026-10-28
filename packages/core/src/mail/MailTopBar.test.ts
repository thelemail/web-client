import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const state = vi.hoisted(() => ({
	page: { params: { slot: '3' }, url: new URL('http://x/u/3/mail/inbox') },
	openLink: vi.fn()
}));

vi.mock('$app/state', () => ({
	get page() {
		return state.page;
	}
}));
vi.mock('$platform', () => ({
	platform: { openLink: (url: string) => state.openLink(url) }
}));

import MailTopBar from './MailTopBar.svelte';

function at(path: string) {
	state.page = { params: { slot: '3' }, url: new URL(`http://x/u/3/mail/${path}`) };
	return render(MailTopBar);
}

describe('MailTopBar', () => {
	it('searches mail with operators from a mail folder', () => {
		const { container } = at('inbox/abc');
		expect(container.querySelector('.search input')?.getAttribute('placeholder')).toBe('Search mail');
	});

	it('scopes the search placeholder to drafts and scheduled', () => {
		expect(at('drafts').container.querySelector('.search input')?.getAttribute('placeholder')).toMatch(/draft/i);
		expect(at('scheduled').container.querySelector('.search input')?.getAttribute('placeholder')).toMatch(/scheduled/i);
	});

	it('links settings to the current account slot', () => {
		const { container } = at('inbox');
		expect(container.querySelector('a.mt-btn')?.getAttribute('href')).toBe('/u/3/settings');
	});

	it('opens the documentation from help', () => {
		const { container } = at('inbox');
		container.querySelector<HTMLButtonElement>('button[aria-label="Help"]')!.click();
		expect(state.openLink).toHaveBeenCalledWith('https://thelemail.com/documentation');
	});
});
