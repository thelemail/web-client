import { describe, expect, it } from 'vitest';
import {
	ancestorIds,
	filterEntries,
	moveAmongSiblings,
	nextPosition,
	orderTree,
	siblingIds,
	visibleEntries,
	type CollectionNode
} from './tree';

function node(id: string, parentId: string | null, position: number, name = id): CollectionNode {
	return { id, kind: 'folder', parentId, position, rev: 1, name, color: null, favorite: false, sealed: false };
}

describe('orderTree', () => {
	it('walks parents before children in position order and builds full paths', () => {
		const out = orderTree([
			node('acme', 'clients', 2048, 'Acme'),
			node('home', null, 2048, 'Home'),
			node('clients', null, 1024, 'Clients'),
			node('beta', 'clients', 1024, 'Beta')
		]);
		expect(out.map((e) => [e.path, e.depth])).toEqual([
			['Clients', 0],
			['Clients / Beta', 1],
			['Clients / Acme', 1],
			['Home', 0]
		]);
	});

	it('keeps duplicate names under different parents apart', () => {
		const out = orderTree([
			node('home', null, 1, 'Home'),
			node('work', null, 2, 'Work'),
			node('r1', 'home', 1, 'Receipts'),
			node('r2', 'work', 1, 'Receipts')
		]);
		expect(out.filter((e) => e.name === 'Receipts').map((e) => e.path)).toEqual([
			'Home / Receipts',
			'Work / Receipts'
		]);
	});

	it('lifts a node whose parent is gone to the top level instead of dropping it', () => {
		const out = orderTree([node('orphan', 'deleted-parent', 1, 'Orphan')]);
		expect(out).toHaveLength(1);
		expect(out[0].depth).toBe(0);
		expect(out[0].path).toBe('Orphan');
	});

	it('breaks position ties by name', () => {
		const out = orderTree([node('b', null, 0, 'beta'), node('a', null, 0, 'Alpha')]);
		expect(out.map((e) => e.name)).toEqual(['Alpha', 'beta']);
	});
});

describe('nextPosition', () => {
	it('appends after the last sibling of the same parent', () => {
		const nodes = [node('a', null, 1024), node('b', null, 4096), node('c', 'a', 9999)];
		expect(nextPosition(nodes, null)).toBe(5120);
		expect(nextPosition(nodes, 'a')).toBe(11023);
		expect(nextPosition(nodes, 'b')).toBe(1024);
	});
});

describe('sidebar tree helpers', () => {
	const entries = orderTree([
		node('clients', null, 1024, 'Clients'),
		node('acme', 'clients', 1024, 'Acme'),
		node('invoices', 'acme', 1024, 'Invoices'),
		node('beta', 'clients', 2048, 'Beta'),
		node('home', null, 2048, 'Home'),
		node('travel', 'home', 1024, 'Travel')
	]);

	it('hides the descendants of collapsed parents only', () => {
		expect(visibleEntries(entries, new Set()).map((e) => e.id)).toEqual(['clients', 'home']);
		expect(visibleEntries(entries, new Set(['clients'])).map((e) => e.id)).toEqual([
			'clients',
			'acme',
			'beta',
			'home'
		]);
		expect(visibleEntries(entries, new Set(['acme'])).map((e) => e.id)).toEqual(['clients', 'home']);
		expect(visibleEntries(entries, new Set(['clients', 'acme', 'home'])).map((e) => e.id)).toEqual([
			'clients',
			'acme',
			'invoices',
			'beta',
			'home',
			'travel'
		]);
	});

	it('lists siblings in display order and moves one within them', () => {
		expect(siblingIds(entries, 'beta')).toEqual(['acme', 'beta']);
		expect(siblingIds(entries, 'home')).toEqual(['clients', 'home']);
		expect(moveAmongSiblings(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
		expect(moveAmongSiblings(['a', 'b', 'c'], 'a', 9)).toEqual(['b', 'c', 'a']);
		expect(moveAmongSiblings(['a', 'b'], 'x', 0)).toEqual(['a', 'b']);
	});

	it('walks ancestors from the nearest parent up', () => {
		expect(ancestorIds(entries, 'invoices')).toEqual(['acme', 'clients']);
		expect(ancestorIds(entries, 'home')).toEqual([]);
	});

	it('filters by name and keeps the path to every match', () => {
		expect(filterEntries(entries, 'inv').map((e) => e.id)).toEqual(['clients', 'acme', 'invoices']);
		expect(filterEntries(entries, 'TRAV').map((e) => e.id)).toEqual(['home', 'travel']);
		expect(filterEntries(entries, '  ')).toHaveLength(entries.length);
		expect(filterEntries(entries, 'nothing')).toEqual([]);
	});
});
