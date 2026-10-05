import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { orderTree, type CollectionNode } from './collections/tree';

const { mailCollections, accountSettings, goto, ACME } = vi.hoisted(() => ({
	ACME: '00000000-0000-4000-8000-0000000000ac',
	goto: vi.fn(async () => {}),
	mailCollections: {
		loaded: true,
		nodes: [] as CollectionNode[],
		folders: [] as unknown[],
		labels: [] as unknown[],
		favorites: [] as unknown[],
		byId: vi.fn(),
		hasChildren: vi.fn(),
		setFavorite: vi.fn(async () => {}),
		reorder: vi.fn(async () => {})
	},
	accountSettings: {
		mailSidebar: { expanded: [] as string[], collapsed: [] as string[], showMore: false },
		persistMailSidebar: vi.fn()
	}
}));

vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$app/state', () => ({ page: { params: { slot: '0', folder: `f-${ACME}` } } }));
vi.mock('$core/stores/mailCollections.svelte', () => ({ mailCollections }));
vi.mock('$core/stores/accountSettings.svelte', () => ({ accountSettings }));
vi.mock('$core/stores/billing.svelte', () => ({ billing: { subscription: null } }));
vi.mock('./RailSearch.svelte', () => ({ default: () => {} }));
vi.mock('./RailAccount.svelte', () => ({ default: () => {} }));

import Sidebar from './Sidebar.svelte';

function node(
	id: string,
	parentId: string | null,
	position: number,
	name: string,
	kind: 'folder' | 'label' = 'folder',
	favorite = false
): CollectionNode {
	return { id, kind, parentId, position, rev: 1, name, color: null, favorite, sealed: false };
}

function setNodes(nodes: CollectionNode[]) {
	mailCollections.nodes = nodes;
	mailCollections.folders = orderTree(nodes.filter((n) => n.kind === 'folder'));
	mailCollections.labels = orderTree(nodes.filter((n) => n.kind === 'label'));
	const all = [...mailCollections.folders, ...mailCollections.labels] as { id: string; favorite: boolean }[];
	mailCollections.favorites = all.filter((e) => e.favorite);
	mailCollections.byId.mockImplementation((id: string) => all.find((e) => e.id === id));
	mailCollections.hasChildren.mockImplementation((id: string) => nodes.some((n) => n.parentId === id));
}

const counts = { inbox: 2, starred: 0, drafts: 0, spam: 0, snoozed: 0, scheduled: 0 };

async function renderSidebar() {
	const target = document.body.appendChild(document.createElement('div'));
	target.className = 'mail-app';
	const r = render(Sidebar, {
		target,
		props: {
			counts,
			folderCounts: { clients: { direct: 0, subtree: 3 } },
			labelCounts: {},
			onCompose: vi.fn()
		}
	});
	await tick();
	return r;
}

describe('mail sidebar', () => {
	afterEach(() => {
		cleanup();
		document.body.innerHTML = '';
	});

	beforeEach(() => {
		vi.clearAllMocks();
		accountSettings.mailSidebar = { expanded: [], collapsed: [], showMore: false };
		setNodes([
			node('clients', null, 1024, 'Clients'),
			node(ACME, 'clients', 1024, 'Acme'),
			node('home', null, 2048, 'Home', 'folder', true),
			node('tax', null, 1024, 'Tax', 'label')
		]);
	});

	function treeIds(container: HTMLElement, label: string) {
		const tree = container.querySelector(`[role="tree"][aria-label="${label}"]`);
		return [...(tree?.querySelectorAll<HTMLAnchorElement>('a[role="treeitem"]') ?? [])].map(
			(a) => a.dataset.id
		);
	}

	it('lists favorites, folders and labels and reveals the open folder', async () => {
		const { container } = await renderSidebar();
		expect(treeIds(container, 'Favorites')).toEqual(['home']);
		expect(treeIds(container, 'Folders')).toEqual(['clients', ACME, 'home']);
		expect(treeIds(container, 'Labels')).toEqual(['tax']);
		const acme = container.querySelector(`[role="tree"][aria-label="Folders"] a[data-id="${ACME}"]`);
		expect(acme?.getAttribute('aria-current')).toBe('page');
		expect(container.querySelector('.rail-find')).toBeNull();
	});

	it('remembers a collapsed section and an expanded folder', async () => {
		const { container, getByRole } = await renderSidebar();
		await fireEvent.click(getByRole('button', { name: 'Labels' }));
		expect(accountSettings.persistMailSidebar).toHaveBeenLastCalledWith({
			expanded: [],
			collapsed: ['labels'],
			showMore: false
		});

		const chev = container.querySelector<HTMLButtonElement>('button.ctree-chev')!;
		expect(chev.getAttribute('aria-label')).toBe('Collapse Clients');
		await fireEvent.click(chev);
		expect(accountSettings.persistMailSidebar).toHaveBeenLastCalledWith(
			expect.objectContaining({ expanded: [] })
		);
		await tick();
		expect(container.querySelector('button.ctree-chev')?.getAttribute('aria-label')).toBe(
			'Expand Clients'
		);
	});

	it('drops ids of deleted folders when it saves expansion', async () => {
		accountSettings.mailSidebar = { expanded: ['gone', 'clients'], collapsed: [], showMore: false };
		const { getByRole } = await renderSidebar();
		await fireEvent.click(getByRole('button', { name: 'More' }));
		expect(accountSettings.persistMailSidebar).toHaveBeenLastCalledWith({
			expanded: ['clients'],
			collapsed: [],
			showMore: true
		});
	});

	it('pins from the row menu', async () => {
		const { container, findByRole } = await renderSidebar();
		const more = container.querySelector<HTMLButtonElement>(
			'[role="tree"][aria-label="Labels"] button.ctree-more'
		)!;
		await fireEvent.click(more);
		const item = await findByRole('menuitem', { name: 'Add to favorites' });
		await fireEvent.click(item);
		await waitFor(() => expect(mailCollections.setFavorite).toHaveBeenCalledWith('tax', true));
	});

	it('offers a finder once the lists get long and filters both trees', async () => {
		setNodes(
			Array.from({ length: 13 }, (_, i) => node(`f${i}`, null, (i + 1) * 1024, `Project ${i}`)).concat(
				node('travel', null, 1024, 'Travel', 'label')
			)
		);
		const { container, getByLabelText } = await renderSidebar();
		const input = getByLabelText('Find a folder or label') as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'project 1' } });
		expect(treeIds(container, 'Folders')).toEqual(['f1', 'f10', 'f11', 'f12']);
		expect(container.querySelector('[role="tree"][aria-label="Labels"]')).toBeNull();

		await fireEvent.keyDown(input, { key: 'Escape' });
		expect(input.value).toBe('');
	});
});
