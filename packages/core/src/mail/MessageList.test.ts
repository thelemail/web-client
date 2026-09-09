import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import MessageList from './MessageList.svelte';
import { EMPTY_FILTERS, type Message } from './data';
import { mailActionsFor } from './actions';

beforeAll(() => {
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

describe('MessageList search states', () => {
	it('hides the pagination sentinel while showing search results', () => {
		const { container } = mount({ list: [message('m1')], searchActive: true });
		expect(container.querySelector('.list-foot')).toBeNull();
	});

	it('states the scope a completed search covered', () => {
		const { container } = mount({ list: [message('m1')], searchActive: true });
		expect(container.querySelector('.srch-strip')?.textContent).toContain('All mail');
	});

	it('says how far it has read while the index is still building', () => {
		const { container } = mount({
			list: [],
			searchActive: true,
			searchComplete: false,
			searchIndexed: 1240
		});
		const strip = container.querySelector('.srch-strip')?.textContent ?? '';
		expect(strip).toContain('1,240');
		expect(strip).not.toContain('All mail');
	});

	it('does not call an incomplete search a definitive no-match', () => {
		const { container } = mount({
			list: [],
			searchActive: true,
			searchComplete: false,
			searchIndexed: 1240
		});
		expect(container.textContent).toContain('No match yet');
		expect(container.textContent).not.toContain('Nothing in your mail matches that.');
	});

	it('is definitive once the whole archive is indexed', () => {
		const { container } = mount({ list: [], searchActive: true, searchComplete: true });
		expect(container.textContent).toContain('Nothing in your mail matches that.');
	});

	it('names the filters that were applied', () => {
		const { container } = mount({
			list: [message('m1')],
			searchActive: true,
			searchChips: ['from:anna', 'unread']
		});
		const chips = [...container.querySelectorAll('.srch-chip')].map((c) => c.textContent?.trim());
		expect(chips).toEqual(['from:anna', 'unread']);
	});

	it('shows no chips for a plain free-text search', () => {
		const { container } = mount({ list: [message('m1')], searchActive: true });
		expect(container.querySelectorAll('.srch-chip')).toHaveLength(0);
	});

	it('offers to clear the search rather than the filters', () => {
		const { container } = mount({ list: [], searchActive: true });
		expect(container.querySelector('.empty-clear')?.textContent).toContain('Clear search');
	});
});
