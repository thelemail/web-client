import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { m } from '$paraglide/messages.js';

const nav = vi.hoisted(() => ({
	page: { params: { slot: '0' }, url: new URL('http://x/u/0/settings/profile') },
	platform: {} as { notifications?: unknown; updates?: unknown }
}));

vi.mock('$app/state', () => ({
	get page() {
		return nav.page;
	}
}));
vi.mock('$platform', () => ({
	get platform() {
		return nav.platform;
	}
}));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { email: 'ada@thelemail.com' } }));
vi.mock('$core/stores/workspaces.svelte', () => ({ workspaces: { workspace: { name: 'Ada' } } }));

import SettingsNav from './SettingsNav.svelte';

function at(section: string) {
	nav.page = { params: { slot: '0' }, url: new URL(`http://x/u/0/settings/${section}`) };
}

const view = { width: 390, content: 1300 };
const restore: (() => void)[] = [];

function stub(prop: string, get: (el: HTMLElement) => number) {
	const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
	Object.defineProperty(HTMLElement.prototype, prop, {
		configurable: true,
		get(this: HTMLElement) {
			return get(this);
		}
	});
	restore.push(() => {
		if (original) Object.defineProperty(HTMLElement.prototype, prop, original);
	});
}

function snavIndex(el: HTMLElement): number {
	const strip = el.closest('.nav-groups');
	return strip ? [...strip.querySelectorAll('a.snav')].indexOf(el) : -1;
}

function narrowLayout() {
	stub('clientWidth', (el) => (el.classList.contains('nav-groups') ? view.width : 0));
	stub('scrollWidth', (el) => (el.classList.contains('nav-groups') ? view.content : 0));
	stub('offsetLeft', (el) => Math.max(0, snavIndex(el)) * 100);
	stub('offsetWidth', (el) => (snavIndex(el) >= 0 ? 90 : 0));
}

beforeEach(() => {
	nav.platform = {};
	at('profile');
});

afterEach(() => {
	cleanup();
	restore.splice(0).forEach((undo) => undo());
	view.width = 390;
	view.content = 1300;
});

describe('SettingsNav', () => {
	it('is a named landmark with one labelled list per group', () => {
		render(SettingsNav);
		const landmark = screen.getByRole('navigation', { name: m.settings_nav_aria() });
		const lists = within(landmark).getAllByRole('list');
		expect(lists.map((l) => l.getAttribute('aria-labelledby'))).toEqual(['snav-account', 'snav-mail', 'snav-app']);
		within(landmark).getByRole('list', { name: m.settings_nav_group_mail() });
	});

	it('hides notifications and about on web and shows them where supported', () => {
		render(SettingsNav);
		expect(screen.queryByRole('link', { name: m.settings_nav_notify() })).toBeNull();
		expect(screen.queryByRole('link', { name: m.settings_nav_about() })).toBeNull();
		cleanup();
		nav.platform = { notifications: {}, updates: {} };
		render(SettingsNav);
		screen.getByRole('link', { name: m.settings_nav_notify() });
		screen.getByRole('link', { name: m.settings_nav_about() });
	});

	it('marks the current section and keeps routes unchanged', () => {
		at('reading');
		render(SettingsNav);
		const current = screen.getByRole('link', { current: 'page' });
		expect(current.textContent).toBe(m.settings_nav_reading());
		expect(current.getAttribute('href')).toBe('/u/0/settings/reading');
		expect(current.classList.contains('active')).toBe(true);
	});

	it('scrolls a deep-linked section into view on a narrow strip', async () => {
		narrowLayout();
		at('appearance');
		const { container } = render(SettingsNav);
		await tick();
		const strip = container.querySelector<HTMLElement>('.nav-groups')!;
		const active = strip.querySelector<HTMLElement>('[aria-current="page"]')!;
		expect(strip.scrollLeft).toBeGreaterThan(0);
		expect(active.offsetLeft).toBeGreaterThanOrEqual(strip.scrollLeft);
		expect(active.offsetLeft + active.offsetWidth).toBeLessThanOrEqual(strip.scrollLeft + strip.clientWidth);
	});

	it('cues overflow only on the sides with hidden items', async () => {
		narrowLayout();
		at('profile');
		const { container } = render(SettingsNav);
		await tick();
		const strip = container.querySelector<HTMLElement>('.nav-groups')!;
		expect(strip.scrollLeft).toBe(0);
		expect(strip.hasAttribute('data-more-start')).toBe(false);
		expect(strip.hasAttribute('data-more-end')).toBe(true);

		strip.scrollLeft = 400;
		strip.dispatchEvent(new Event('scroll'));
		await tick();
		expect(strip.hasAttribute('data-more-start')).toBe(true);
		expect(strip.hasAttribute('data-more-end')).toBe(true);

		strip.scrollLeft = view.content - view.width;
		strip.dispatchEvent(new Event('scroll'));
		await tick();
		expect(strip.hasAttribute('data-more-start')).toBe(true);
		expect(strip.hasAttribute('data-more-end')).toBe(false);
	});

	it('shows no overflow cue when everything fits', async () => {
		narrowLayout();
		view.width = 1300;
		const { container } = render(SettingsNav);
		window.dispatchEvent(new Event('resize'));
		await tick();
		const strip = container.querySelector<HTMLElement>('.nav-groups')!;
		expect(strip.hasAttribute('data-more-start')).toBe(false);
		expect(strip.hasAttribute('data-more-end')).toBe(false);
	});
});
