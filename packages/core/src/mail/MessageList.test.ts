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

describe('MessageList header', () => {
	it('titles the list with the folder and its unread count', () => {
		const { container } = mount({ list: [message('m1')], folderUnread: 1234 });
		const header = container.querySelector('.list-h')!;
		expect(header.querySelector('.search input')).toBeNull();
		expect(header.querySelector('h1 .ttl-name')?.textContent).toBe('Inbox');
		expect(header.querySelector('.ttl-ct .sr-only')?.textContent?.trim()).toBe(
			`${new Intl.NumberFormat().format(1234)} unread`
		);
	});

	it('leaves the count out when nothing is unread', () => {
		const { container } = mount({ list: [message('m1')], folderUnread: 0 });
		expect(container.querySelector('.ttl-ct')).toBeNull();
	});

	it('switches between all and unread through the unread filter', async () => {
		const onSetFilters = vi.fn();
		const { container, rerender } = mount({ list: [message('m1')], onSetFilters });
		const [all, unread] = [...container.querySelectorAll<HTMLButtonElement>('.seg button')];
		expect(all.getAttribute('aria-pressed')).toBe('true');
		expect(unread.getAttribute('aria-pressed')).toBe('false');
		all.click();
		expect(onSetFilters).not.toHaveBeenCalled();
		unread.click();
		expect(onSetFilters).toHaveBeenCalledWith({ ...EMPTY_FILTERS, unread: true });
		await rerender({ filters: { ...EMPTY_FILTERS, unread: true } });
		expect(unread.getAttribute('aria-pressed')).toBe('true');
		all.click();
		expect(onSetFilters).toHaveBeenLastCalledWith({ ...EMPTY_FILTERS, unread: false });
	});

	it('shows no view strip for the default sort without filters', () => {
		const { container } = mount({ list: [message('m1')] });
		expect(container.querySelector('.view-strip')).toBeNull();
	});

	it('shows the sort below the header and resets it', async () => {
		const onSort = vi.fn();
		const { container } = mount({ list: [message('m1')], sort: 'oldest', onSort });
		const strip = container.querySelector('.view-strip');
		expect(strip).not.toBeNull();
		(strip?.querySelector('.list-sub-x') as HTMLButtonElement).click();
		expect(onSort).toHaveBeenCalledWith('newest');
	});

	it('shows active filters below the header and clears them', () => {
		const onSetFilters = vi.fn();
		const { container } = mount({
			list: [message('m1')],
			filters: { ...EMPTY_FILTERS, unread: true },
			onSetFilters
		});
		const strip = container.querySelector('.view-strip');
		expect(strip?.textContent).toContain('1');
		(strip?.querySelector('.list-sub-x') as HTMLButtonElement).click();
		expect(onSetFilters).toHaveBeenCalledWith({ ...EMPTY_FILTERS });
	});
});

describe('MessageList position across updates', () => {
	const ROW = 80;

	function layout(container: HTMLElement) {
		const scroll = container.querySelector<HTMLElement>('.scroll')!;
		let top = 0;
		Object.defineProperty(scroll, 'scrollTop', {
			configurable: true,
			get: () => top,
			set: (v: number) => (top = v)
		});
		Object.defineProperty(scroll, 'clientHeight', { configurable: true, get: () => 400 });
		scroll.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
			const rows = [...scroll.querySelectorAll('.mrow')];
			const i = rows.indexOf(this);
			const y = i * ROW - top;
			return { top: y, bottom: y + ROW } as DOMRect;
		});
		return scroll;
	}

	const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => message(`m${from + i}`));

	it('keeps the visible row in place when mail arrives above it', async () => {
		const list = ids(10, 2);
		const { container, rerender } = mount({ list });
		const scroll = layout(container);
		scroll.scrollTop = 250;
		await rerender({ list: [...ids(2), ...list] });
		expect(scroll.scrollTop).toBe(250 + 2 * ROW);
		vi.restoreAllMocks();
	});

	it('leaves the top of the list alone so new mail shows', async () => {
		const list = ids(10, 2);
		const { container, rerender } = mount({ list });
		const scroll = layout(container);
		await rerender({ list: [...ids(2), ...list] });
		expect(scroll.scrollTop).toBe(0);
		vi.restoreAllMocks();
	});

	it('keeps the selection when mail arrives', async () => {
		const list = ids(4, 2);
		const checked = new Set(['m3']);
		const { container, rerender } = mount({ list, checked });
		await rerender({ list: [...ids(2), ...list], checked });
		const selected = [...container.querySelectorAll('.mrow.sel')].map((r) => (r as HTMLElement).dataset.id);
		expect(selected).toEqual(['m3']);
	});

	it('returns focus to the row that was open', async () => {
		const list = ids(4);
		const { container, rerender } = mount({ list, activeId: 'm2' });
		(document.activeElement as HTMLElement | null)?.blur();
		await rerender({ list, activeId: null });
		const row = container.querySelector<HTMLElement>('.mrow[data-id="m2"]')!;
		expect(document.activeElement).toBe(row.querySelector('.mrow-open'));
	});

	it('does not steal focus from elsewhere when the message closes', async () => {
		const list = ids(4);
		const outside = document.body.appendChild(document.createElement('input'));
		const { rerender } = mount({ list, activeId: 'm2' });
		outside.focus();
		await rerender({ list, activeId: null });
		expect(document.activeElement).toBe(outside);
		outside.remove();
	});
});
