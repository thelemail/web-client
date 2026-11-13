import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import MessageList from './MessageList.svelte';
import { EMPTY_FILTERS, type Message } from './data';
import { mailActionsFor } from './actions';
import { INDICATOR_DELAY_MS, INDICATOR_MIN_MS } from '$core/async/delayed.svelte';

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

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

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

function props(extra: Record<string, unknown>) {
	return {
		folderLabel: 'Inbox',
		list: [],
		activeId: null,
		checked: new Set<string>(),
		allChecked: false,
		sort: 'newest',
		filters: { ...EMPTY_FILTERS },
		caps: mailActionsFor('inbox'),
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
		...extra
	};
}

const EMPTY_TEXT = 'Inbox is empty';

describe('MessageList first load', () => {
	it('never says the folder is empty before the first page arrives', async () => {
		const { container } = render(MessageList, { props: props({ loaded: false }) });
		expect(container.textContent).not.toContain(EMPTY_TEXT);
		await vi.advanceTimersByTimeAsync(INDICATOR_DELAY_MS * 4);
		expect(container.textContent).not.toContain(EMPTY_TEXT);
	});

	it('shows the row skeleton only after the delay', async () => {
		const { container } = render(MessageList, { props: props({ loaded: false }) });
		await vi.advanceTimersByTimeAsync(INDICATOR_DELAY_MS - 1);
		expect(container.querySelector('.lsk')).toBeNull();
		await vi.advanceTimersByTimeAsync(1);
		expect(container.querySelector('.lsk')).not.toBeNull();
	});

	it('keeps the skeleton for the minimum time before showing rows', async () => {
		const view = render(MessageList, { props: props({ loaded: false }) });
		await vi.advanceTimersByTimeAsync(INDICATOR_DELAY_MS);
		await view.rerender(props({ loaded: true, list: [message('m1')] }));
		expect(view.container.querySelector('.lsk')).not.toBeNull();
		await vi.advanceTimersByTimeAsync(INDICATOR_MIN_MS);
		expect(view.container.querySelector('.lsk')).toBeNull();
		expect(view.container.textContent).toContain('Permission slip');
	});

	it('shows rows straight away when they arrive before the delay', async () => {
		const view = render(MessageList, { props: props({ loaded: false }) });
		await vi.advanceTimersByTimeAsync(50);
		await view.rerender(props({ loaded: true, list: [message('m1')] }));
		expect(view.container.textContent).toContain('Permission slip');
		expect(view.container.querySelector('.lsk')).toBeNull();
	});

	it('says the folder is empty once an empty first page arrived', () => {
		const { container } = render(MessageList, { props: props({ loaded: true }) });
		expect(container.textContent).toContain(EMPTY_TEXT);
	});

	it('shows a failed first load as an error with a retry, not as empty', async () => {
		const onRetry = vi.fn();
		const { container, getByRole } = render(MessageList, {
			props: props({ loaded: false, loadError: 'offline', onRetry })
		});
		expect(container.textContent).not.toContain(EMPTY_TEXT);
		expect(getByRole('alert').textContent).toContain('could not be loaded');
		await fireEvent.click(getByRole('button', { name: /try again/i }));
		expect(onRetry).toHaveBeenCalled();
	});

	it('keeps rows and adds a notice when a refresh failed', () => {
		const { container } = render(MessageList, {
			props: props({ loaded: true, loadError: 'down', list: [message('m1')] })
		});
		expect(container.textContent).toContain('Permission slip');
		expect(container.querySelector('.state-strip.warn')).not.toBeNull();
	});

	it('says when it shows the offline copy and does not claim the end of the list', () => {
		const { container } = render(MessageList, {
			props: props({ loaded: true, offline: true, exhausted: true, list: [message('m1')] })
		});
		expect(container.textContent).toContain('Offline');
		expect(container.textContent).not.toContain('end of conversation list');
	});

	it('holds a placeholder instead of a wrong folder name', () => {
		const { container } = render(MessageList, { props: props({ folderLabel: null, loaded: true }) });
		expect(container.querySelector('.ttl-wait')).not.toBeNull();
		expect(container.querySelector('.list-h .ttl')?.textContent).not.toContain('Inbox');
	});
});
