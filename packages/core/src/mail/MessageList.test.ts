import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, within } from '@testing-library/svelte';
const finish = vi.hoisted(() => ({ canFinishSearchSetup: vi.fn(() => true), finishSearchSetup: vi.fn() }));
vi.mock('$core/custody/search-setup', () => finish);

import MessageList from './MessageList.svelte';
import { EMPTY_FILTERS, type Message } from './data';
import { mailActionsFor } from './actions';
import type { SearchView } from './searchView';
import { loadSearchStrip } from './searchStrip';
import type { Chip } from '$core/search/chips';
import type { CoverageView } from '$core/search/coverage';

beforeAll(async () => {
	await loadSearchStrip();
	vi.stubGlobal(
		'IntersectionObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		}
	);
});

const caps = mailActionsFor('inbox');

function message(id: string): Message {
	return {
		id,
		folder: 'inbox',
		direction: 'received',
		from: 'Anna',
		fromAddr: 'anna@school.pt',
		to: 'me@thelemail.com',
		init: 'A',
		bg: '#fff',
		fg: '#000',
		subj: 'Permission slip',
		labels: [],
		unread: false,
		starred: false,
		prev: 'please sign',
		body: [],
		epoch: 1_700_000_000_000
	};
}

function mount(props: Record<string, unknown>) {
	return render(MessageList, {
		props: {
			folderLabel: 'Inbox',
			list: [],
			activeId: null,
			checked: new Set<string>(),
			allChecked: false,
			sort: 'newest',
			filters: { ...EMPTY_FILTERS },
			caps,
			onOpen: () => {},
			onToggleStar: () => {},
			onToggleCheck: () => {},
			onArchive: () => {},
			onTrash: () => {},
			onToggleRead: () => {},
			onToggleAll: () => {},
			onBulk: () => {},
			onSort: () => {},
			onSetFilters: () => {},
			...props
		}
	});
}

describe('MessageList pagination trigger', () => {
	it('keeps the load-more sentinel when the visible list is empty', () => {
		const { container } = mount({ list: [], exhausted: false });
		expect(container.querySelector('.list-foot')).not.toBeNull();
	});

	it('keeps the sentinel once rows exist', () => {
		const { container } = mount({ list: [message('m1')], exhausted: false });
		expect(container.querySelector('.list-foot')).not.toBeNull();
	});

	it('does not claim the end of the list while more pages remain', () => {
		const { container } = mount({ list: [], exhausted: false });
		expect(container.textContent).not.toContain('end of conversation list');
	});

	it('does not claim the end of an empty exhausted folder', () => {
		const { container } = mount({ list: [], exhausted: true });
		expect(container.textContent).not.toContain('end of conversation list');
	});
});

function view(over: Partial<SearchView> = {}): SearchView {
	return {
		phase: 'ready',
		mode: 'saved',
		consent: 'saved',
		canEnable: true,
		query: 'permission',
		matches: 1,
		groups: 1,
		final: true,
		chips: [],
		error: null,
		errorRange: null,
		suggestions: [],
		coverage: complete,
		sort: 'relevance',
		exactFolders: false,
		newAvailable: false,
		paused: false,
		limited: null,
		settingsHref: '/u/0/settings/search',
		onSort: vi.fn(),
		onExactFolders: vi.fn(),
		onRemoveChip: vi.fn(),
		onSuggestion: vi.fn(),
		onRefresh: vi.fn(),
		onRetry: vi.fn(),
		onClear: vi.fn(),
		onEnable: vi.fn(),
		onDecline: vi.fn(),
		...over
	};
}

const complete: CoverageView = {
	dimensions: [
		{ dimension: 1, total: 10, done: 10, excluded: 0, gaps: {} },
		{ dimension: 2, total: 10, done: 10, excluded: 0, gaps: {} }
	],
	inventoryDone: true,
	complete: true,
	syncedAt: 1,
	waitingOn: null
};

const partial: CoverageView = {
	dimensions: [
		{ dimension: 1, total: 18_510, done: 18_510, excluded: 0, gaps: {} },
		{ dimension: 2, total: 18_510, done: 18_420, excluded: 0, gaps: { waiting: 78, locked: 12 } }
	],
	inventoryDone: true,
	complete: false,
	syncedAt: 1,
	waitingOn: null
};

function chip(text: string, over: Partial<Chip> = {}): Chip {
	return { key: text, text, kind: 'filter', negated: false, range: { start: 0, end: text.length }, matches: 0, descendants: 0, ...over };
}

describe('MessageList search states', () => {
	it('keeps the pagination sentinel under search results so more pages load', () => {
		const { container } = mount({ list: [message('m1')], search: view() });
		expect(container.querySelector('.list-foot')).not.toBeNull();
	});

	it('states how many conversations matched', () => {
		const { container } = mount({ list: [message('m1')], search: view({ groups: 1240 }) });
		expect(container.querySelector('.ss-status')?.textContent).toBe('1,240 conversations');
	});

	it('shows a running count while the first page is provisional', () => {
		const { container } = mount({ list: [message('m1')], search: view({ phase: 'searching', final: false, matches: 60, groups: 50 }) });
		expect(container.querySelector('.ss-status')?.textContent).toBe('Searching, 50 found so far');
	});

	it('says how much message text is indexed and why the rest is missing', async () => {
		const { container } = mount({ list: [message('m1')], search: view({ coverage: partial }) });
		const { getByRole } = within(container);
		expect(container.querySelector('.ss-cover')?.textContent).toContain('Message text: 18,420 of 18,510 indexed');
		await getByRole('button', { name: /Details/ }).click();
		const details = container.querySelector('.ss-cov')?.textContent ?? '';
		expect(details).toContain('Waiting: 78');
		expect(details).toContain('Missing a key on this device: 12');
	});

	it('does not call an incomplete search a definitive no-match', () => {
		const { container } = mount({ list: [], search: view({ matches: 0, groups: 0, coverage: partial }) });
		expect(container.querySelector('.empty-list .t')?.textContent).toBe('No matches in indexed mail');
		expect(container.textContent).not.toContain('Nothing in your mail matches that.');
	});

	it('is definitive once every relevant field is indexed', () => {
		const { container } = mount({ list: [], search: view({ matches: 0, groups: 0 }) });
		expect(container.textContent).toContain('Nothing in your mail matches that.');
	});

	it('is never definitive in preview mode', () => {
		const { container } = mount({ list: [], search: view({ mode: 'preview', consent: 'declined', matches: 0, groups: 0, coverage: partial }) });
		expect(container.querySelector('.empty-list .t')?.textContent).toBe('No matches in indexed mail');
		expect(container.querySelector('.ss-mode')?.textContent).toBe('Searching subjects, senders and previews only');
	});

	it('offers one-time setup before the user has chosen', () => {
		const onEnable = vi.fn();
		const { container } = mount({ list: [], search: view({ mode: 'preview', consent: null, onEnable }) });
		const card = within(container.querySelector('.ss-setup') as HTMLElement);
		card.getByRole('button', { name: 'Turn on full search' }).click();
		expect(onEnable).toHaveBeenCalled();
		expect(card.getByRole('button', { name: 'Not now' })).toBeTruthy();
	});

	it('does not offer full search to an account that cannot hold an index yet', () => {
		const { container } = mount({ list: [], search: view({ mode: 'preview', consent: null, canEnable: false, matches: 0, groups: 0, coverage: partial }) });
		expect(container.querySelector('.ss-setup')).toBeNull();
		expect(within(container).queryByRole('button', { name: 'Turn on full search' })).toBeNull();
		expect(container.querySelector('.ss-mode')?.textContent).toBe('Searching subjects, senders and previews only');
	});

	it('names each filter and removes one on request', () => {
		const onRemoveChip = vi.fn();
		const chips = [chip('from:anna'), chip('is:unread')];
		const { container } = mount({ list: [message('m1')], search: view({ chips, onRemoveChip }) });
		const { getByRole } = within(container);
		const shown = [...container.querySelectorAll('.srch-chip > span[dir]')].map((c) => c.textContent?.trim());
		expect(shown).toEqual(['from:anna', 'is:unread']);
		getByRole('button', { name: 'Remove is:unread' }).click();
		expect(onRemoveChip).toHaveBeenCalledWith(chips[1]);
	});

	it('flags a label name shared by several labels and offers exact folders', () => {
		const chips = [chip('label:"Tax 2026"', { kind: 'label', matches: 2 }), chip('in:Projects', { kind: 'folder', descendants: 3 })];
		const { container } = mount({ list: [message('m1')], search: view({ chips }) });
		expect(container.querySelector('.ss-note')?.textContent).toBe('2 labels');
		expect(container.querySelector('.ss-exact')?.textContent).toContain('Only this folder');
	});

	it('offers a spelling suggestion as a clickable replacement', () => {
		const onSuggestion = vi.fn();
		const suggestion = { range: { start: 0, end: 6 }, original: 'invoce', replacement: 'invoice' };
		const { container } = mount({ list: [], search: view({ matches: 0, groups: 0, suggestions: [suggestion], onSuggestion }) });
		const { getByRole } = within(container);
		getByRole('button', { name: 'invoice' }).click();
		expect(onSuggestion).toHaveBeenCalledWith(suggestion);
	});

	it('announces new mail without reordering results', () => {
		const onRefresh = vi.fn();
		const { container } = mount({ list: [message('m1')], search: view({ newAvailable: true, onRefresh }) });
		const { getByRole } = within(container);
		getByRole('button', { name: /New mail arrived/ }).click();
		expect(onRefresh).toHaveBeenCalled();
	});

	it('offers to clear the search rather than the filters', () => {
		const { container } = mount({ list: [], search: view({ matches: 0, groups: 0 }) });
		expect(container.querySelector('.empty-clear')?.textContent).toContain('Clear search');
	});

	it('explains a search it could not run and marks where', () => {
		const { container } = mount({
			list: [],
			search: view({ phase: 'failed', query: 'from:x "open', error: 'A quote is missing its closing mark.', errorRange: { start: 7, end: 12 } })
		});
		expect(container.querySelector('.empty-list .t')?.textContent).toBe("Can't run this search");
		expect(container.querySelector('.empty-list .d')?.textContent).toBe('A quote is missing its closing mark.');
		expect(container.querySelector('.q-err mark')?.textContent).toBe('"open');
		expect(container.querySelector('.empty-clear')?.textContent).toContain('Clear search');
	});

	it('says search is locked rather than empty', () => {
		const { container } = mount({ list: [], search: view({ phase: 'locked', groups: null, matches: null, final: false }) });
		expect(container.querySelector('.empty-list .t')?.textContent).toBe('Search is locked');
	});

	it('asks for the password once when the account has not finished converting', () => {
		const { container } = mount({ list: [], search: view({ phase: 'unconverted', groups: null, matches: null, final: false }) });
		expect(container.querySelector('.empty-list .t')?.textContent).toBe('Search needs one more step');
		const button = container.querySelector('.empty-clear') as HTMLButtonElement;
		expect(button.textContent).toContain('Confirm password');
		button.click();
		expect(finish.finishSearchSetup).toHaveBeenCalled();
	});

	it('offers a retry when the device cannot search', () => {
		const onRetry = vi.fn();
		const { container } = mount({ list: [], search: view({ phase: 'unavailable', groups: null, matches: null, final: false, onRetry }) });
		(container.querySelector('.empty-clear') as HTMLButtonElement).click();
		expect(onRetry).toHaveBeenCalled();
	});

	it('announces the final count to screen readers', () => {
		const { container } = mount({ list: [message('m1')], search: view({ groups: 3 }) });
		expect(container.querySelector('.srch-strip [role="status"]')?.textContent).toBe('3 conversations');
	});
});
