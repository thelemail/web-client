import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { userEvent } from 'vitest/browser';
import { flushSync } from 'svelte';

vi.mock('$app/env/public', () => ({
	PUBLIC_API_BASE_URL: 'https://api.test.thelemail.local',
	PUBLIC_SUBMISSION_BASE_URL: 'https://submit.test.thelemail.local',
	PUBLIC_OFFICIAL_SENDER_POLICY: undefined,
	PUBLIC_TLOG_POLICY: undefined,
	PUBLIC_DIRECTORY_SIGNING_PUBLIC_KEY_ARMORED: undefined,
	PUBLIC_LAUNCHED_PRODUCTS: undefined,
	PUBLIC_PRODUCT_ORIGINS: undefined,
	PUBLIC_THELEMAIL_PRODUCT: undefined
}));
vi.mock('$app/env', () => ({ browser: true, dev: true, building: false, version: 'test' }));

const goto = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({
	page: {
		params: { slot: '0', folder: 'inbox' },
		url: new URL('https://app.test/u/0/mail/inbox?unread=true'),
		state: {}
	}
}));

const indexSearch = vi.hoisted(() => vi.fn());
vi.mock('$core/search', () => ({
	searchIndex: {
		search: (...a: unknown[]) => indexSearch(...a),
		sync: vi.fn(async () => {}),
		close: vi.fn(),
		subscribe: () => () => {}
	}
}));
vi.mock('$platform', () => ({ platform: {} }));

import ListSearch from './ListSearch.svelte';
import { mailSearch } from '$core/stores/search.svelte';

function hit(id: string, subject: string) {
	return {
		row: {
			accountId: 'acc-1',
			id,
			chunkId: 0,
			storedAt: 1_700_000_000_000,
			direction: 'received',
			mailboxState: 'inbox',
			read: true,
			starred: false,
			labels: [],
			attachmentCount: 0,
			threadRootId: null,
			snoozedUntil: null
		},
		text: {
			id,
			subject,
			senderDisplay: 'Anna',
			senderAddress: 'anna@school.test',
			recipients: '',
			snippet: ''
		},
		excerpt: '',
		score: 1
	};
}

let stop: () => void;

beforeEach(() => {
	goto.mockClear();
	indexSearch.mockReset();
	indexSearch.mockReturnValue([hit('m1', 'Permission slip'), hit('m2', 'Permission form')]);
	stop = mailSearch.start('acc-1');
	document.body.className = '';
	const host = document.body.appendChild(document.createElement('div'));
	host.className = 'mail-app';
});

afterEach(() => {
	cleanup();
	stop();
	document.body.innerHTML = '';
});

function mount() {
	return render(ListSearch, { target: document.querySelector('.mail-app')! });
}

describe('mail search box', () => {
	it('shows matches in the popup and leaves the list alone while typing', async () => {
		const { getByRole, findAllByRole } = mount();
		const input = getByRole('combobox');
		await userEvent.click(input);
		await userEvent.type(input, 'permission');
		await vi.waitFor(() => expect(mailSearch.preview).toHaveLength(2));

		const options = await findAllByRole('option');
		expect(options.map((o) => o.textContent)).toEqual(
			expect.arrayContaining([expect.stringContaining('Permission slip')])
		);
		expect(options.at(-1)?.textContent).toContain('Show all results');
		expect(mailSearch.active).toBe(false);
		expect(input.getAttribute('aria-expanded')).toBe('true');
	});

	it('commits on Enter, closes the popup and keeps focus in the box', async () => {
		const { getByRole } = mount();
		const input = getByRole('combobox');
		await userEvent.click(input);
		await userEvent.type(input, 'permission');
		await vi.waitFor(() => expect(mailSearch.preview).toHaveLength(2));

		await userEvent.keyboard('{Enter}');
		flushSync();

		expect(mailSearch.committed).toBe('permission');
		expect(mailSearch.active).toBe(true);
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(input);
	});

	it('commits from the Show all results row', async () => {
		const { getByRole, findByRole } = mount();
		await userEvent.click(getByRole('combobox'));
		await userEvent.type(getByRole('combobox'), 'permission');
		await userEvent.click(await findByRole('option', { name: /show all results/i }));

		expect(mailSearch.committed).toBe('permission');
	});

	it('moves through options with the arrows and opens the highlighted match without searching', async () => {
		const { getByRole } = mount();
		const input = getByRole('combobox');
		await userEvent.click(input);
		await userEvent.type(input, 'permission');
		await vi.waitFor(() => expect(mailSearch.preview).toHaveLength(2));

		await userEvent.keyboard('{ArrowDown}');
		const active = input.getAttribute('aria-activedescendant');
		expect(active).toBeTruthy();
		expect(document.getElementById(active!)?.getAttribute('aria-selected')).toBe('true');

		await userEvent.keyboard('{Enter}');

		expect(goto).toHaveBeenCalledWith('/u/0/mail/inbox/m1?unread=true', expect.objectContaining({ reset: false }));
		expect(mailSearch.active).toBe(false);
	});

	it('closes the popup on the first Escape and clears on the second', async () => {
		const { getByRole } = mount();
		const input = getByRole('combobox');
		await userEvent.click(input);
		await userEvent.type(input, 'permission');
		await userEvent.keyboard('{Enter}');
		await userEvent.click(input);
		await userEvent.keyboard('{ArrowDown}');
		expect(input.getAttribute('aria-expanded')).toBe('true');

		await userEvent.keyboard('{Escape}');
		expect(input.getAttribute('aria-expanded')).toBe('false');
		expect(mailSearch.committed).toBe('permission');

		await userEvent.keyboard('{Escape}');
		expect(mailSearch.committed).toBe('');
		expect((input as HTMLInputElement).value).toBe('');
	});
});
