import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { orderTree, type CollectionNode } from '$core/mail/collections/tree';

const { mailCollections } = vi.hoisted(() => ({
	mailCollections: {
		loaded: true,
		locked: false,
		nodes: [] as CollectionNode[],
		folders: [] as unknown[],
		labels: [] as unknown[],
		byId: vi.fn(),
		folder: vi.fn(),
		hasChildren: vi.fn(),
		ready: vi.fn(async () => {}),
		create: vi.fn(),
		setFavorite: vi.fn(async () => {}),
		reorder: vi.fn(async () => {}),
		edit: vi.fn(async () => {}),
		recolor: vi.fn(async () => {}),
		moveTo: vi.fn(async () => {}),
		remove: vi.fn(async () => {})
	}
}));

vi.mock('$core/stores/mailCollections.svelte', () => ({ mailCollections }));
vi.mock('$core/stores/auth.svelte', () => ({ auth: { accountId: 'acc-1' } }));

import Collections from './Collections.svelte';

function node(
	id: string,
	parentId: string | null,
	name: string,
	kind: 'folder' | 'label' = 'folder',
	sealed = false,
	position = 1024
): CollectionNode {
	return { id, kind, parentId, position, rev: 1, name, color: null, favorite: false, sealed };
}

function setNodes(nodes: CollectionNode[]) {
	mailCollections.nodes = nodes;
	mailCollections.folders = orderTree(nodes.filter((n) => n.kind === 'folder'));
	mailCollections.labels = orderTree(nodes.filter((n) => n.kind === 'label'));
	const all = [...mailCollections.folders, ...mailCollections.labels] as { id: string; kind: string }[];
	mailCollections.byId.mockImplementation((id: string) => all.find((e) => e.id === id));
	mailCollections.folder.mockImplementation((id: string) =>
		all.find((e) => e.id === id && e.kind === 'folder')
	);
	mailCollections.hasChildren.mockImplementation((id: string) => nodes.some((n) => n.parentId === id));
}

async function renderPage() {
	const target = document.body.appendChild(document.createElement('div'));
	target.className = 'settings-app';
	const r = render(Collections, { target });
	await tick();
	return r;
}

function rowNames(container: HTMLElement, list: string) {
	return [...container.querySelectorAll(`ul[aria-label="${list}"] .coll-set-name > span`)].map(
		(s) => s.textContent
	);
}

describe('folders and labels settings', () => {
	afterEach(() => {
		cleanup();
		document.body.innerHTML = '';
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mailCollections.locked = false;
		setNodes([
			node('work', null, 'Work'),
			node('w-misc', 'work', 'Misc'),
			node('home', null, 'Home', 'folder', false, 2048),
			node('h-misc', 'home', 'Misc'),
			node('empty', null, 'Empty', 'folder', false, 3072),
			node('tax', null, 'Tax', 'label'),
			node('sealed', null, 'Locked', 'label', true)
		]);
	});

	it('lists every folder and label, empty ones included, with paths for repeated names', async () => {
		const { container } = await renderPage();
		expect(rowNames(container, 'Folders')).toEqual(['Work', 'Misc', 'Home', 'Misc', 'Empty']);
		expect([...container.querySelectorAll('.coll-set-path')].map((p) => p.textContent)).toEqual([
			'Work / Misc',
			'Home / Misc'
		]);
		expect(rowNames(container, 'Labels')).toEqual(['Locked', 'Tax']);
		expect(container.querySelector('button[aria-label="Actions for Locked"]')).toBeNull();
	});

	it('creates a folder inline and checks the name before saving', async () => {
		mailCollections.create.mockResolvedValue({ id: 'new', kind: 'folder', path: 'Projects' });
		const { getByRole, getByLabelText, findByText } = await renderPage();
		await fireEvent.click(getByRole('button', { name: 'New folder' }));
		const input = getByLabelText('Folder name') as HTMLInputElement;

		await fireEvent.input(input, { target: { value: 'a/b' } });
		expect(await findByText("Names can't contain a slash (/).")).toBeTruthy();
		await fireEvent.submit(input.form!);
		expect(mailCollections.create).not.toHaveBeenCalled();

		await fireEvent.input(input, { target: { value: 'Projects' } });
		await fireEvent.submit(input.form!);
		await waitFor(() => expect(mailCollections.create).toHaveBeenCalledWith('folder', 'Projects', null, null));
	});

	it('deletes a label from the row menu and says the mail stays', async () => {
		const { container, findByRole, getByRole, findByText } = await renderPage();
		await fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Actions for Tax"]')!);
		await fireEvent.click(await findByRole('menuitem', { name: 'Delete label…' }));

		expect(await findByText(/No mail is deleted or moved/)).toBeTruthy();
		await fireEvent.click(getByRole('button', { name: 'Delete label' }));
		await waitFor(() => expect(mailCollections.remove).toHaveBeenCalledWith('tax', undefined));
	});

	it('reorders from the menu so dragging is never required', async () => {
		const { container, findByRole } = await renderPage();
		await fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Actions for Empty"]')!);
		await fireEvent.click(await findByRole('menuitem', { name: 'Move up' }));
		await waitFor(() =>
			expect(mailCollections.reorder).toHaveBeenCalledWith('folder', null, ['work', 'empty', 'home'])
		);
	});

	it('asks where a folder’s mail goes and offers other folders by path', async () => {
		const { container, findByRole, getByRole } = await renderPage();
		await fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Actions for Empty"]')!);
		await fireEvent.click(await findByRole('menuitem', { name: 'Delete folder…' }));

		await fireEvent.click(getByRole('radio', { name: 'Another folder' }));
		const select = getByRole('combobox', { name: 'Another folder' }) as HTMLSelectElement;
		expect([...select.options].map((o) => o.textContent)).toEqual([
			'Choose a folder',
			'Work',
			'Work / Misc',
			'Home',
			'Home / Misc'
		]);
		expect((getByRole('button', { name: 'Delete folder' }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.change(select, { target: { value: 'h-misc' } });
		await fireEvent.click(getByRole('button', { name: 'Delete folder' }));
		await waitFor(() =>
			expect(mailCollections.remove).toHaveBeenCalledWith('empty', { kind: 'folder', folderId: 'h-misc' })
		);
	});
});
