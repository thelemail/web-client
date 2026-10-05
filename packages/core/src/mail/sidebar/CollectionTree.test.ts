import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { orderTree, type CollectionNode } from '../collections/tree';
import CollectionTree from './CollectionTree.svelte';

function node(id: string, parentId: string | null, position: number, name: string, favorite = false): CollectionNode {
	return { id, kind: 'folder', parentId, position, rev: 1, name, color: null, favorite, sealed: false };
}

const all = orderTree([
	node('clients', null, 1024, 'Clients'),
	node('acme', 'clients', 1024, 'Acme'),
	node('beta', 'clients', 2048, 'Beta'),
	node('home', null, 2048, 'Home')
]);

const handlers = {
	onToggle: vi.fn(),
	onExpandSiblings: vi.fn(),
	onMenu: vi.fn(),
	onMove: vi.fn(),
	onReorder: vi.fn(),
	onNavigate: vi.fn()
};

function renderTree(over: Record<string, unknown> = {}) {
	return render(CollectionTree, {
		label: 'Folders',
		entries: all,
		all,
		expanded: new Set<string>(),
		counts: { clients: { direct: 1, subtree: 5 }, acme: { direct: 4, subtree: 4 } },
		activeRoute: 'f-home',
		slotBase: '/u/0',
		...handlers,
		...over
	});
}

function links(container: HTMLElement) {
	return [...container.querySelectorAll<HTMLAnchorElement>('a[role="treeitem"]')];
}

describe('collection tree', () => {
	beforeEach(() => {
		for (const fn of Object.values(handlers)) fn.mockReset();
	});

	it('hides collapsed children and rolls their unread into the parent badge', () => {
		const { container } = renderTree();
		const rows = links(container);
		expect(rows.map((a) => a.dataset.id)).toEqual(['clients', 'home']);
		expect(rows[0].getAttribute('aria-expanded')).toBe('false');
		expect(rows[0].querySelector('.ct')?.textContent).toBe('5');
		expect(rows[0].getAttribute('aria-label')).toBe('Clients, 5 unread including subfolders');
		expect(rows[1].getAttribute('aria-expanded')).toBeNull();
	});

	it('shows the parent its own unread once its children are on screen', () => {
		const { container } = renderTree({ expanded: new Set(['clients']) });
		const rows = links(container);
		expect(rows.map((a) => a.dataset.id)).toEqual(['clients', 'acme', 'beta', 'home']);
		expect(rows[0].querySelector('.ct')?.textContent).toBe('1');
		expect(rows[1].getAttribute('aria-level')).toBe('2');
		expect(rows[1].getAttribute('aria-label')).toBe('Clients / Acme, 4 unread');
	});

	it('keeps one tab stop on the open folder and marks it current', () => {
		const { container } = renderTree();
		const rows = links(container);
		expect(rows.map((a) => a.tabIndex)).toEqual([-1, 0]);
		expect(rows[1].getAttribute('aria-current')).toBe('page');
		expect(rows[1].getAttribute('href')).toBe('/u/0/mail/f-home');
	});

	it('walks the tree with arrow keys and expands or climbs with right and left', async () => {
		const { container } = renderTree({ expanded: new Set(['clients']) });
		const rows = links(container);
		rows[0].focus();
		await fireEvent.keyDown(rows[0], { key: 'ArrowDown' });
		expect(document.activeElement).toBe(rows[1]);
		await fireEvent.keyDown(rows[1], { key: 'End' });
		expect(document.activeElement).toBe(rows[3]);
		await fireEvent.keyDown(rows[3], { key: 'Home' });
		expect(document.activeElement).toBe(rows[0]);

		await fireEvent.keyDown(rows[0], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(rows[1]);
		await fireEvent.keyDown(rows[1], { key: 'ArrowLeft' });
		expect(document.activeElement).toBe(rows[0]);
		await fireEvent.keyDown(rows[0], { key: 'ArrowLeft' });
		expect(handlers.onToggle).toHaveBeenCalledWith('clients', false);
	});

	it('expands a collapsed parent on right arrow and jumps by typed letters', async () => {
		const { container } = renderTree();
		const rows = links(container);
		rows[0].focus();
		await fireEvent.keyDown(rows[0], { key: 'ArrowRight' });
		expect(handlers.onToggle).toHaveBeenCalledWith('clients', true);
		await fireEvent.keyDown(rows[0], { key: 'h' });
		expect(document.activeElement).toBe(rows[1]);
	});

	it('reorders and opens the menu from the keyboard', async () => {
		const { container } = renderTree({ expanded: new Set(['clients']) });
		const rows = links(container);
		await fireEvent.keyDown(rows[2], { key: 'ArrowUp', altKey: true, shiftKey: true });
		expect(handlers.onMove).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }), -1);
		await fireEvent.keyDown(rows[2], { key: 'F10', shiftKey: true });
		expect(handlers.onMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'beta' }), rows[2], rows[2]);
	});

	it('opens the menu at the pointer on right click without navigating', async () => {
		const { container } = renderTree();
		const row = links(container)[1];
		const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 90 });
		row.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
		expect(handlers.onMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'home' }), { x: 40, y: 90 }, row);
	});

	it('toggles from the chevron and lists favorites flat with their full path', async () => {
		const { container } = renderTree();
		const chev = container.querySelector<HTMLButtonElement>('button.ctree-chev')!;
		expect(chev.getAttribute('aria-label')).toBe('Expand Clients');
		await fireEvent.click(chev);
		expect(handlers.onToggle).toHaveBeenCalledWith('clients', true);

		const fav = render(CollectionTree, {
			label: 'Favorites',
			entries: all.filter((e) => e.id === 'acme'),
			all,
			flat: true,
			expanded: new Set<string>(),
			counts: {},
			activeRoute: null,
			slotBase: '/u/0',
			...handlers
		});
		const [row] = links(fav.container);
		expect(fav.container.querySelector('.ctree-chev')).toBeNull();
		expect(row.getAttribute('aria-level')).toBe('1');
		expect(row.title).toBe('Clients / Acme');
		expect(container).toBeTruthy();
	});
});
