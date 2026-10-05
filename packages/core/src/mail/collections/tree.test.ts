import { describe, expect, it } from 'vitest';
import { nextPosition, orderTree, type CollectionNode } from './tree';

function node(id: string, parentId: string | null, position: number, name = id): CollectionNode {
	return { id, kind: 'folder', parentId, position, rev: 1, name, color: null, sealed: false };
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
