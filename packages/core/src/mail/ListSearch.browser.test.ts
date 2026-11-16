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

vi.mock('$platform', () => ({ platform: {} }));
vi.mock('$core/keystore/keystore-client', () => ({ keystore: { subscribeAccount: () => () => {} } }));
vi.mock('$core/stores/addresses.svelte', () => ({ addresses: { items: [] } }));
vi.mock('$core/stores/mailCollections.svelte', () => ({
	mailCollections: { folders: [], labels: [{ id: 'l1', name: 'Tax 2026', path: 'Tax 2026', sealed: false }] }
}));
const openDraft = vi.hoisted(() => vi.fn());
vi.mock('$core/stores/compose.svelte', () => ({ composeStore: { openDraft } }));

const engine = vi.hoisted(() => ({
	query: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
	complete: null as unknown as ReturnType<typeof import('vitest').vi.fn>,
	history: [] as string[],
	rows: [] as unknown[]
}));
vi.mock('$core/search/lazy', () => {
	const client = {
		subscribe: (l: (s: unknown) => void) => {
			l({ phase: 'ready', role: 'owner', status: null });
			return () => {};
		},
		query: (...a: unknown[]) => engine.query(...a),
		page: async () => ({ ok: true, groups: engine.rows }),
		closeQuery: async () => {},
		complete: (...a: unknown[]) => engine.complete(...a),
		history: async () => engine.history,
		remember: async () => {}
	};
	return {
		searchSupported: () => true,
		searchRuntime: {
			focus: async () => {},
			client: () => Promise.resolve(client),
			subscribePrefs: (cb: (p: unknown) => void) => {
				cb({ accountId: 'acc-1', consent: 'saved', paused: false, history: true });
				return () => {};
			}
		}
	};
});

import ListSearch from './ListSearch.svelte';
import { mailSearch } from '$core/stores/search.svelte';

function hit(id: string, subject: string, kind = 1) {
	return {
		key: id,
		threadId: id,
		matches: 1,
		exact: false,
		score: 1,
		date: 1_700_000_000_000,
		best: { kind, sourceId: id },
		sources: [{ kind, sourceId: id }],
		subject,
		subjectSpans: [],
		from: { name: 'Anna', address: 'anna@school.test' },
		to: [],
		flags: 1 | 4,
		knownFlags: 0x1ff,
		attachments: 0,
		folders: [],
		labels: [],
		excerpt: null,
		filename: null,
		fields: []
	};
}

let stop: () => void;

beforeEach(() => {
	goto.mockClear();
	openDraft.mockClear();
	engine.rows = [hit('m1', 'Permission slip'), hit('m2', 'Permission form')];
	engine.history = [];
	engine.query = vi.fn(async () => ({
		ok: true,
		summary: { id: 1, matches: engine.rows.length, groups: engine.rows.length, pages: 1, incomplete: 0, excluded: 0, suggestions: [], generation: 0, dims: [], resolved: [] }
	}));
	engine.complete = vi.fn(async () => ({ terms: [], people: [] }));
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

	it('opens a draft result in the composer', async () => {
		engine.rows = [hit('d1', 'Lunch plan', 2)];
		const { getByRole } = mount();
		const input = getByRole('combobox');
		await userEvent.click(input);
		await userEvent.type(input, 'lunch');
		await vi.waitFor(() => expect(mailSearch.preview).toHaveLength(1));
		await userEvent.keyboard('{ArrowDown}');
		await userEvent.keyboard('{Enter}');
		expect(openDraft).toHaveBeenCalledWith('d1');
		expect(goto).not.toHaveBeenCalled();
	});

	it('completes people and words from this device', async () => {
		engine.complete = vi.fn(async () => ({ terms: ['invoices'], people: [{ name: 'Inês Moreira', address: 'ines@example.com' }] }));
		const { getByRole, findByRole } = mount();
		const input = getByRole('combobox');
		await userEvent.click(input);
		await userEvent.type(input, 'ine');
		await userEvent.click(await findByRole('option', { name: /Inês Moreira/ }));
		expect((input as HTMLInputElement).value).toBe('from:ines@example.com ');
		expect(mailSearch.active).toBe(false);
	});

	it('suggests label names after label:', async () => {
		const { getByRole, findByRole } = mount();
		const input = getByRole('combobox');
		await userEvent.click(input);
		await userEvent.type(input, 'label:tax');
		await userEvent.click(await findByRole('option', { name: /Tax 2026/ }));
		expect((input as HTMLInputElement).value).toBe('label:"Tax 2026" ');
	});

	it('offers recent searches and runs one when chosen', async () => {
		engine.history = ['from:anna permission'];
		const { getByRole, findByRole } = mount();
		const input = getByRole('combobox');
		await userEvent.click(input);
		mailSearch.commit('budget');
		await vi.waitFor(() => expect(mailSearch.history).toEqual(['from:anna permission']));
		mailSearch.setDraft('');
		await userEvent.click(await findByRole('option', { name: /from:anna permission/ }));
		expect(mailSearch.committed).toBe('from:anna permission');
	});

	it('does not search while an input method is composing', async () => {
		const { getByRole } = mount();
		const input = getByRole('combobox') as HTMLInputElement;
		await userEvent.click(input);
		input.dispatchEvent(new CompositionEvent('compositionstart'));
		input.value = 'とう';
		input.dispatchEvent(new InputEvent('input', { isComposing: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
		flushSync();
		expect(mailSearch.draft).toBe('');
		expect(mailSearch.committed).toBe('');
		input.value = '東京';
		input.dispatchEvent(new CompositionEvent('compositionend'));
		flushSync();
		expect(mailSearch.draft).toBe('東京');
		expect(mailSearch.committed).toBe('');
	});

	it('marks the box invalid and describes the error after a bad query', async () => {
		const { getByRole } = mount();
		const input = getByRole('combobox');
		await userEvent.click(input);
		await userEvent.type(input, '"open');
		await userEvent.keyboard('{Enter}');
		await vi.waitFor(() => expect(input.getAttribute('aria-invalid')).toBe('true'));
		const described = document.getElementById(input.getAttribute('aria-describedby')!);
		expect(described?.textContent).toBe(mailSearch.error);
	});
});
